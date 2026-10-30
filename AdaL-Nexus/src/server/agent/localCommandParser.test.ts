import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { parseLocalCommand } from "./localCommandParser.js";
import { taskContext } from "./taskContext.js";

describe("Local Command Parser (Hindi, Hinglish & English)", () => {
  test("parses YouTube open commands in English and Hinglish", () => {
    const en = parseLocalCommand("open youtube");
    assert.ok(en);
    assert.equal(en.plan.steps[0].tool, "browser.open_url");
    assert.equal((en.plan.steps[0].input as any).url, "https://www.youtube.com");

    const hi = parseLocalCommand("YouTube kholo");
    assert.ok(hi);
    assert.equal(hi.plan.steps[0].tool, "browser.open_url");
    assert.equal((hi.plan.steps[0].input as any).url, "https://www.youtube.com");
  });

  test("parses YouTube video playback in Hinglish with artist/song query", () => {
    const d1 = parseLocalCommand("YouTube par Arijit Singh ka song play karo");
    assert.ok(d1);
    assert.equal(d1.plan.steps[0].tool, "browser.play_youtube_video");
    assert.match((d1.plan.steps[0].input as any).query.toLowerCase(), /arijit singh/);

    const d2 = parseLocalCommand("play Arijit Singh song on YouTube");
    assert.ok(d2);
    assert.equal(d2.plan.steps[0].tool, "browser.play_youtube_video");
    assert.match((d2.plan.steps[0].input as any).query.toLowerCase(), /arijit singh/);
  });

  test("parses new tab and tab switching commands in Hindi & English", () => {
    const newTab = parseLocalCommand("Naya tab kholo");
    assert.ok(newTab);
    assert.equal(newTab.plan.steps[0].tool, "browser.new_tab");

    const prevTab = parseLocalCommand("Pichhle tab par jao");
    assert.ok(prevTab);
    assert.equal(prevTab.plan.steps[0].tool, "browser.switch_tab");
    assert.equal((prevTab.plan.steps[0].input as any).target, "previous");

    const nextTab = parseLocalCommand("agla tab par jao");
    assert.ok(nextTab);
    assert.equal(nextTab.plan.steps[0].tool, "browser.switch_tab");
    assert.equal((nextTab.plan.steps[0].input as any).target, "next");
  });

  test("parses close tab, refresh, and history navigation", () => {
    const closeTab = parseLocalCommand("tab band karo");
    assert.ok(closeTab);
    assert.equal(closeTab.plan.steps[0].tool, "browser.close_tab");

    const refresh = parseLocalCommand("Is website ko refresh karo");
    assert.ok(refresh);
    assert.equal(refresh.plan.steps[0].tool, "browser.refresh");

    const back = parseLocalCommand("peeche jao");
    assert.ok(back);
    assert.equal(back.plan.steps[0].tool, "browser.back");

    const fwd = parseLocalCommand("aage jao");
    assert.ok(fwd);
    assert.equal(fwd.plan.steps[0].tool, "browser.forward");
  });

  test("parses search query on Google / DuckDuckGo", () => {
    const searchHi = parseLocalCommand("Google par Python tutorials search karo");
    assert.ok(searchHi);
    assert.equal(searchHi.plan.steps[0].tool, "browser.open_url");
    assert.match((searchHi.plan.steps[0].input as any).url, /google\.com\/search/);
    assert.match((searchHi.plan.steps[0].input as any).url, /python%20tutorials/);

    const searchDdg = parseLocalCommand("search machine learning on duckduckgo");
    assert.ok(searchDdg);
    assert.equal(searchDdg.plan.steps[0].tool, "browser.search");
    assert.match((searchDdg.plan.steps[0].input as any).query, /machine learning/);
  });

  test("parses multi-step chained requests using 'aur' and 'and'", () => {
    const multi = parseLocalCommand("Naya tab kholo aur Google kholo");
    assert.ok(multi);
    assert.equal(multi.plan.steps.length, 2);
    assert.equal(multi.plan.steps[0].tool, "browser.new_tab");
    assert.equal(multi.plan.steps[1].tool, "browser.open_url");
    assert.equal((multi.plan.steps[1].input as any).url, "https://www.google.com");

    const multiYt = parseLocalCommand("YouTube kholo aur Arijit Singh ka song play karo");
    assert.ok(multiYt);
    assert.equal(multiYt.plan.steps.length, 2);
    assert.equal(multiYt.plan.steps[0].tool, "browser.open_url");
    assert.equal(multiYt.plan.steps[1].tool, "browser.play_youtube_video");
  });

  test("parses media pause command", () => {
    const pause = parseLocalCommand("video pause karo");
    assert.ok(pause);
    assert.equal(pause.plan.steps[0].tool, "browser.pause_media");

    const ganaRoko = parseLocalCommand("gana roko");
    assert.ok(ganaRoko);
    assert.equal(ganaRoko.plan.steps[0].tool, "browser.pause_media");
  });

  test("parses multi-step research requests in Hindi and Hinglish", () => {
    const res = parseLocalCommand("Machine learning par research karo");
    assert.ok(res);
    assert.equal(res.plan.steps.length, 3);
    assert.equal(res.plan.steps[0].tool, "research.find_sources");
    assert.equal(res.plan.steps[1].tool, "research.collect");
    assert.equal(res.plan.steps[2].tool, "research.consolidate");
    assert.match((res.plan.steps[0].input as any).query.toLowerCase(), /machine learning/);
  });

  test("parses research to Excel with topic and context fallback", () => {
    // 1. With explicit topic: "Google par recent AI agent frameworks compare karo aur Excel report banao"
    const withTopic = parseLocalCommand("Google par recent AI agent frameworks compare karo aur Excel report banao");
    assert.ok(withTopic);
    assert.equal(withTopic.plan.steps.length, 5);
    assert.equal(withTopic.plan.steps[0].tool, "research.find_sources");
    assert.equal(withTopic.plan.steps[3].tool, "sheet.write");
    assert.equal(withTopic.plan.steps[4].tool, "sheet.verify");

    // 2. Without topic and empty context -> requests clarification per requirement 6
    taskContext.clear();
    const missingTopic = parseLocalCommand("Research ka Excel bana do");
    assert.ok(missingTopic);
    assert.equal(missingTopic.plan.steps[0].tool, "system.note");
    assert.equal((missingTopic.plan.steps[0].input as any).isClarification, true);

    // 3. With context remembered -> executes full 5-step pipeline reusing topic
    taskContext.setLastTopic("Deep Learning Startups");
    const withContext = parseLocalCommand("Research ka Excel bana do");
    assert.ok(withContext);
    assert.equal(withContext.plan.steps.length, 5);
    assert.match((withContext.plan.steps[0].input as any).query, /Deep Learning Startups/);
    assert.equal(withContext.plan.steps[3].tool, "sheet.write");
  });

  test("parses social post draft creation for LinkedIn and X without publishing", () => {
    const draftLi = parseLocalCommand("Meri LinkedIn post ka draft taiyar karo");
    assert.ok(draftLi);
    assert.equal(draftLi.plan.steps[0].tool, "draft.create");
    assert.equal((draftLi.plan.steps[0].input as any).platform, "linkedin");

    const draftX = parseLocalCommand("X par post ka draft banao");
    assert.ok(draftX);
    assert.equal(draftX.plan.steps[0].tool, "draft.create");
    assert.equal((draftX.plan.steps[0].input as any).platform, "twitter");
  });

  test("parses task cancellation request", () => {
    const cancel = parseLocalCommand("Pehle task cancel kar do");
    assert.ok(cancel);
    assert.equal(cancel.plan.steps[0].tool, "system.note");
    assert.match(cancel.plan.steps[0].title.toLowerCase(), /cancel/);
  });

  test("parses current page inspection request", () => {
    const page = parseLocalCommand("ye kaunsi website hai");
    assert.ok(page);
    assert.equal(page.plan.steps[0].tool, "browser.get_current_page");
  });

  test("parses WhatsApp navigation and friend messaging commands in Hindi & Hinglish", () => {
    // 1. User's exact prompt: "mera wahtsaap par jao aur maine apne dost ko message karne ko kaha"
    const userPrompt = parseLocalCommand("mera wahtsaap par jao aur maine apne dost ko message karne ko kaha");
    assert.ok(userPrompt);
    assert.equal(userPrompt.plan.steps[0].tool, "browser.open_url");
    assert.equal((userPrompt.plan.steps[0].input as any).url, "https://web.whatsapp.com");
    assert.equal(userPrompt.plan.steps[1].tool, "browser.wait");
    assert.equal(userPrompt.plan.steps[2].tool, "browser.observe");
    assert.equal(userPrompt.plan.steps[3].tool, "system.note");

    // 2. Simple open WhatsApp: "WhatsApp kholo"
    const openWa = parseLocalCommand("WhatsApp kholo");
    assert.ok(openWa);
    assert.equal(openWa.plan.steps[0].tool, "browser.open_url");
    assert.equal((openWa.plan.steps[0].input as any).url, "https://web.whatsapp.com");

    // 3. Targeted WhatsApp friend message: "WhatsApp par Rahul ko Hello bhejo"
    const targetMsg = parseLocalCommand("WhatsApp par Rahul ko Hello bhejo");
    assert.ok(targetMsg);
    assert.equal(targetMsg.plan.steps.length, 6);
    assert.equal(targetMsg.plan.steps[0].tool, "browser.open_url");
    assert.equal((targetMsg.plan.steps[0].input as any).url, "https://web.whatsapp.com");
    assert.equal(targetMsg.plan.steps[2].tool, "browser.type");
    assert.equal((targetMsg.plan.steps[2].input as any).text, "Rahul");
    assert.equal(targetMsg.plan.steps[4].tool, "browser.type");
    assert.equal((targetMsg.plan.steps[4].input as any).text, "Hello");
    assert.equal(targetMsg.plan.steps[5].tool, "browser.click");
    assert.equal(targetMsg.approvalStepIds.includes("step_6"), true);
  });

  test("returns null for unrecognized non-command input", () => {
    const unrec = parseLocalCommand("asdfghjk qwerty 12345");
    assert.equal(unrec, null);
  });
});
