import { retry, type RetryOptions } from "@std/async";
import type { Config } from "./config.ts";
import { generateRandomIPv6 } from "./ipv6Rotation.ts";
import { ProxyManager } from "./proxyManager.ts";

type FetchInputParameter = Parameters<typeof fetch>[0];
type FetchInitParameterWithClient =
    | RequestInit
    | RequestInit & { client: Deno.HttpClient };
type FetchReturn = ReturnType<typeof fetch>;

export const getFetchClient = (config: Config): {
    (
        input: FetchInputParameter,
        init?: FetchInitParameterWithClient,
    ): FetchReturn;
} => {
    return async (
        input: FetchInputParameter,
        init?: RequestInit,
    ) => {
        try {
            return await performFetch(config, input, init);
        } catch (error) {
            console.error("[Fetch] Request failed. Checking for proxy rotation...", error);
            const newProxy = await ProxyManager.getInstance().getNextWorkingProxy();

            if (newProxy && newProxy !== config.networking.proxy) {
                console.log(`[AutoProxy] Logic requires rotation. Switching to: ${newProxy}`);
                config.networking.proxy = newProxy;
                // Retry with new proxy
                return await performFetch(config, input, init);
            }
            throw error;
        }
    };
};

async function performFetch(
    config: Config,
    input: FetchInputParameter,
    init?: RequestInit,
): Promise<FetchReturn> {
    const proxyAddress = config.networking.proxy;
    const ipv6Block = config.networking.ipv6_block;

    // If proxy or IPv6 rotation is configured, create a custom HTTP client
    if (proxyAddress || ipv6Block) {
        const clientOptions: Deno.CreateHttpClientOptions = {};

        if (proxyAddress) {
            clientOptions.proxy = {
                url: proxyAddress,
            };
        }

        if (ipv6Block) {
            clientOptions.localAddress = generateRandomIPv6(ipv6Block);
        }

        const client = Deno.createHttpClient(clientOptions);
        try {
            const fetchRes = await fetchShim(config, input, {
                client,
                headers: init?.headers,
                method: init?.method,
                body: init?.body,
            });
            return new Response(fetchRes.body, {
                status: fetchRes.status,
                headers: fetchRes.headers,
            });
        } finally {
            client.close(); // Important: close client to avoid leaking resources
        }
    }

    return fetchShim(config, input, init);
}
};

function fetchShim(
    config: Config,
    input: FetchInputParameter,
    init?: FetchInitParameterWithClient,
): FetchReturn {
    const fetchTimeout = config.networking.fetch?.timeout_ms;
    const fetchRetry = config.networking.fetch?.retry?.enabled;
    const fetchMaxAttempts = config.networking.fetch?.retry?.times;
    const fetchInitialDebounce = config.networking.fetch?.retry
        ?.initial_debounce;
    const fetchDebounceMultiplier = config.networking.fetch?.retry
        ?.debounce_multiplier;
    const retryOptions: RetryOptions = {
        maxAttempts: fetchMaxAttempts,
        minTimeout: fetchInitialDebounce,
        multiplier: fetchDebounceMultiplier,
        jitter: 0,
    };

    const callFetch = () =>
        fetch(input, {
            // only set the AbortSignal if the timeout is supplied in the config
            signal: fetchTimeout
                ? AbortSignal.timeout(Number(fetchTimeout))
                : null,
            ...(init || {}),
        });
    // if retry enabled, call retry with the fetch shim, otherwise pass the fetch shim back directly
    return fetchRetry ? retry(callFetch, retryOptions) : callFetch();
}
