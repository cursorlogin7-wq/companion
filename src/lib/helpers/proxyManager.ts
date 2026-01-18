import { Config } from "./config.ts";

interface Proxy {
    url: string;
    protocol: "http" | "socks5";
    lastChecked: number;
    working: boolean;
}

export class ProxyManager {
    private static instance: ProxyManager;
    private proxies: Proxy[] = [];
    private currentProxyIndex = -1;
    private isInitialized = false;

    private readonly HTTP_PROXY_LIST_URL = "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt";
    private readonly SOCKS5_PROXY_LIST_URL = "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt";
    private readonly CHECK_INTERVAL = 300_000; // 5 minutes

    private constructor() { }

    public static getInstance(): ProxyManager {
        if (!ProxyManager.instance) {
            ProxyManager.instance = new ProxyManager();
        }
        return ProxyManager.instance;
    }

    public async init() {
        if (this.isInitialized) return;

        console.log("[ProxyManager] Initializing...");
        await this.fetchProxies();
        this.startBackgroundCheck();
        this.isInitialized = true;
    }

    private async fetchProxies() {
        try {
            console.log("[ProxyManager] Fetching proxy lists...");

            const [httpProxies, socks5Proxies] = await Promise.all([
                this.fetchList(this.HTTP_PROXY_LIST_URL, "http"),
                this.fetchList(this.SOCKS5_PROXY_LIST_URL, "socks5")
            ]);

            this.proxies = [...httpProxies, ...socks5Proxies];
            console.log(`[ProxyManager] Loaded ${this.proxies.length} proxies.`);
        } catch (error) {
            console.error("[ProxyManager] Failed to fetch proxy lists:", error);
        }
    }

    private async fetchList(url: string, protocol: "http" | "socks5"): Promise<Proxy[]> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}`);
        const text = await response.text();
        return text.split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => ({
                url: `${protocol}://${line}`,
                protocol,
                lastChecked: 0,
                working: false
            }));
    }

    private startBackgroundCheck() {
        this.scheduleNextBatch();
    }

    private async scheduleNextBatch() {
        await this.checkBatch(50);
        setTimeout(() => this.scheduleNextBatch(), 5000);
    }

    private async checkBatch(size: number) {
        const unchecked = this.proxies
            .filter(p => !p.working && (Date.now() - p.lastChecked > this.CHECK_INTERVAL))
            .slice(0, size);

        if (unchecked.length === 0) return;

        console.log(`[ProxyManager] Checking ${unchecked.length} proxies...`);

        await Promise.all(unchecked.map(async (proxy) => {
            proxy.lastChecked = Date.now();
            proxy.working = await this.testProxy(proxy);
        }));

        const workingCount = this.proxies.filter(p => p.working).length;
        console.log(`[ProxyManager] Check complete. Working proxies: ${workingCount}`);
    }

    private async testProxy(proxy: Proxy): Promise<boolean> {
        try {
            const client = Deno.createHttpClient({
                proxy: { url: proxy.url }
            });

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch("http://www.google.com/gen_204", {
                client,
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            client.close();
            return response.status === 204;
        } catch {
            return false;
        }
    }

    public async getNextWorkingProxy(): Promise<string | null> {
        // Find a working proxy we haven't just used (simple round-robin through working ones)
        // Or just pick the first working one that is different from current?

        const workingProxies = this.proxies.filter(p => p.working);

        if (workingProxies.length === 0) {
            console.warn("[ProxyManager] No working proxies found. Waiting for checks...");
            // Try to force a check immediately 
            await this.checkBatch(20);
            const retryWorking = this.proxies.filter(p => p.working);
            if (retryWorking.length === 0) return null;
            return retryWorking[0].url;
        }

        // Simple randomization to distribute load if we have multiple
        const randomProxy = workingProxies[Math.floor(Math.random() * workingProxies.length)];
        return randomProxy.url;
    }
}
