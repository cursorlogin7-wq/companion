import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Innertube } from "youtubei.js";

const search = new Hono();

search.get("/suggestions", async (c) => {
    const q = c.req.query("q");
    c.header("access-control-allow-origin", "*");
    c.header("content-type", "application/json");

    if (!q) {
        throw new HTTPException(400, {
            res: new Response(JSON.stringify({ error: "Query parameter 'q' is required" })),
        });
    }

    const innertubeClient = c.get("innertubeClient") as Innertube;

    try {
        const suggestions = await innertubeClient.getSearchSuggestions(q);
        return c.json({
            query: q,
            suggestions: suggestions,
        });
    } catch (error) {
        console.error("[ERROR] Failed to fetch search suggestions:", error);
        throw new HTTPException(500, {
            res: new Response(JSON.stringify({ error: "Failed to fetch search suggestions" })),
        });
    }
});

export default search;
