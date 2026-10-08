import { Router } from "express";
import express from "express";
import { db, campaignResponsesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { applyCampaignPreference, escapeEmailHtml, hashPreferenceToken } from "../lib/campaignPreferences";
const router = Router();
const page = (body: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title></head><body style="font:18px/1.6 system-ui;max-width:600px;margin:60px auto;padding:20px"><h1>Email preferences</h1>${body}</body></html>`;
router.get("/public/campaign-preferences/:token", async (req, res) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const action = req.query.action;
  if (!["unsubscribe", "not_interested"].includes(String(action))) { res.status(400).send(page("Invalid preference")); return; }
  const [link] = await db.select().from(campaignResponsesTable).where(eq(campaignResponsesTable.tokenHash, hashPreferenceToken(req.params.token)));
  if (!link) { res.status(404).send(page("This link is not valid.")); return; }
  const label = action === "unsubscribe" ? "Unsubscribe" : "Not interested right now";
  res.send(page(`<p>${action === "unsubscribe" ? "Stop all marketing emails. Service and billing emails will continue." : "Stop follow-ups for this offer while staying subscribed to other offers."}</p><form method="post"><input type="hidden" name="action" value="${action}"><button style="padding:14px;font:inherit">${label}</button></form>`));
});
router.post("/public/campaign-preferences/:token", express.urlencoded({ extended: false }), async (req, res) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  try { res.send(page(`<p>${escapeEmailHtml(await applyCampaignPreference(req.params.token, req.body.action))}</p>`)); }
  catch (error: any) { res.status(400).send(page(`<p>${escapeEmailHtml(error.message)}</p>`)); }
});
export default router;
