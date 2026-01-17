import requests
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

PROXY_LIST_URL = "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/all/data.txt"
TEST_URL = "https://api.ipify.org"
TIMEOUT = 6
MAX_WORKERS = 30

def fetch_proxy_list():
    r = requests.get(PROXY_LIST_URL, timeout=10)
    r.raise_for_status()
    return [line.strip() for line in r.text.splitlines() if line.strip()]

def test_proxy(proxy_url):
    proxies = {
        "http": proxy_url,
        "https": proxy_url,
    }

    start = time.perf_counter()
    try:
        r = requests.get(
            TEST_URL,
            proxies=proxies,
            timeout=TIMEOUT
        )
        if r.status_code == 200 and r.text.strip():
            elapsed = time.perf_counter() - start
            return proxy_url, elapsed
    except Exception:
        pass

    return None

def main():
    proxies = fetch_proxy_list()
    print(f"[+] Loaded {len(proxies)} proxies")

    working = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(test_proxy, p) for p in proxies]

        for f in as_completed(futures):
            result = f.result()
            if result:
                proxy, speed = result
                working.append((speed, proxy))
                print(f"[OK] {proxy} -> {speed:.2f}s")

    # sort slowest → fastest
    working.sort(key=lambda x: x[0], reverse=True)

    with open("work.txt", "w") as f:
        for speed, proxy in working:
            f.write(f"{proxy}  # {speed:.2f}s\n")

    print(f"\n✅ Saved {len(working)} working proxies to work.txt")

if __name__ == "__main__":
    main()
