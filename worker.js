import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import cron from "node-cron";
import "dotenv/config";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Resolve the owner user_id (first workspace_settings row, or env fallback) ─
let OWNER_USER_ID = process.env.OWNER_USER_ID || null;
async function getOwnerUserId() {
  if (OWNER_USER_ID) return OWNER_USER_ID;
  const { data } = await supabase.from("workspace_settings").select("user_id").limit(1).single();
  OWNER_USER_ID = data?.user_id || null;
  return OWNER_USER_ID;
}

// ─── Pick up queued tasks that are due ───────────────────────────────────────

async function getNextTask() {
  const { data, error } = await supabase
    .from("content_queue")
    .select("*, client_profiles(*)")
    .eq("status", "queued")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data;
}

// ─── Pull supporting context for this client ─────────────────────────────────

async function getClientContext(clientId, primaryKeyword) {
  const [{ data: keywords }, { data: history }, { data: existing }, { data: recentOutputs }] = await Promise.all([
    supabase
      .from("keyword_banks")
      .select("keyword, cluster, intent, funnel_stage, current_position, monthly_volume, difficulty, content_targeting_this")
      .eq("client_id", clientId)
      .order("priority", { ascending: true })
      .limit(40),
    supabase
      .from("content_history")
      .select("title, primary_keyword, summary, published_at, url, performance_notes")
      .eq("client_id", clientId)
      .order("published_at", { ascending: false })
      .limit(15),
    supabase
      .from("keyword_banks")
      .select("content_targeting_this, keyword")
      .eq("client_id", clientId)
      .eq("keyword", primaryKeyword)
      .single(),
    supabase
      .from("content_outputs")
      .select("title, primary_keyword, meta_description, created_at")
      .eq("client_id", clientId)
      .eq("approved", true)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return {
    keywords: keywords || [],
    history: history || [],
    existing: existing || null,
    recentOutputs: recentOutputs || [],
  };
}

// ─── Build system prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(client) {
  return `You are an expert SEO content strategist and writer working exclusively for ${client.name}.

ABOUT THIS CLIENT:
${client.description}

IDEAL CUSTOMER PROFILE:
${client.icp || "Not specified"}

UNIQUE SELLING PROPOSITION:
${client.usp || "Not specified"}

COMPETITORS:
${client.competitors ? client.competitors.join(", ") : "Not specified"}

BRAND VOICE:
${client.brand_voice || "Professional, clear, authoritative. UK English."}

CONTENT GOALS:
${client.content_goals || "Drive organic traffic, build authority, convert visitors"}

CORE WRITING RULES:
- UK English at all times
- No invented statistics or unverified claims
- No filler, no AI-sounding phrases, no padding
- No keyword stuffing — write for people first
- Every piece must have a clear argument or angle
- Match the brand voice above precisely
- Never repeat topics or angles already covered in content history

SEO RULES YOU FOLLOW ON EVERY PIECE:
- Primary keyword must appear in the H1, within the first 100 words, and in at least one H2
- Meta description must be 150-160 characters, lead with the primary keyword, include a clear value proposition
- Title tag must be under 60 characters, lead with the primary keyword, include a location signal where relevant
- Internal links must point to real, named URLs — never placeholder # links
- Local service area must be mentioned in the first 200 words, not buried at the bottom
- For health or YMYL content: include named professional, qualification or credential signal, and at least one trust element (reviews, years operating, number of patients)
- Always surface a featured snippet opportunity — add a concise summary block or definition near the top
- Flag schema opportunities in your output: FAQ schema for Q&A sections, LocalBusiness for service pages
- CTAs must be specific and low-friction — name the action, the service, and ideally a location`
}

// ─── Build task prompt ────────────────────────────────────────────────────────

function buildTaskPrompt(task, client, context) {
  const { keywords, history, existing, recentOutputs } = context

  // Keyword intelligence
  const primaryKwData = keywords.find(k => k.keyword.toLowerCase() === task.primary_keyword.toLowerCase())
  const relatedKeywords = keywords
    .filter(k => k.keyword.toLowerCase() !== task.primary_keyword.toLowerCase())
    .map(k => `- ${k.keyword} (${k.intent}, ${k.funnel_stage}${k.current_position ? `, ranking #${k.current_position}` : ""}${k.monthly_volume ? `, ${k.monthly_volume}/mo` : ""})`)
    .join("\n")

  // Content history
  const historyList = history.length
    ? history.map(h => `- "${h.title}" [${h.primary_keyword}]${h.url ? ` → ${h.url}` : ""}${h.summary ? ` — ${h.summary}` : ""}`).join("\n")
    : "No previous content on record."

  // Recent approved outputs for internal linking opportunities
  const linkTargets = recentOutputs.length
    ? recentOutputs.map(o => `- "${o.title}" targeting "${o.primary_keyword}"`).join("\n")
    : "No approved content yet — note this in your internal linking section."

  // Cannibalisation warning
  const cannibalWarning = existing?.content_targeting_this
    ? `\nCANNIBALISATION WARNING: Content already exists targeting this keyword at ${existing.content_targeting_this}. Your piece must take a clearly different angle. State the differentiation at the top of your brief section.`
    : ""

  return `CONTENT BRIEF
=============
Client: ${client.name}
Content type: ${task.content_type.replace(/_/g, " ")}
Primary keyword: ${task.primary_keyword}${primaryKwData?.monthly_volume ? ` (${primaryKwData.monthly_volume}/mo, KD ${primaryKwData.difficulty || "unknown"})` : ""}
Supporting keywords: ${task.supporting_keywords?.join(", ") || "none specified"}
Target word count: ${task.word_count} words
${task.title_brief ? `Angle / brief: ${task.title_brief}` : ""}
${cannibalWarning}

KEYWORD CONTEXT:
${relatedKeywords || "No additional keyword data."}

CONTENT HISTORY (do not repeat these angles):
${historyList}

INTERNAL LINKING OPPORTUNITIES (use these where relevant, with real URLs if available):
${linkTargets}

---

REQUIRED OUTPUT FORMAT — follow this exactly:

TITLE_TAG: [Under 60 characters. Lead with primary keyword. Include location where relevant.]

META_DESCRIPTION: [150-160 characters. Lead with primary keyword. Clear value proposition. Include location.]

H1: [The page H1. Must contain the primary keyword naturally. Human-readable, not stuffed.]

SNIPPET_BLOCK:
[A 2-4 sentence summary of the article's core answer, designed to be pulled as a featured snippet. Place this near the top of the article, immediately after the intro.]

SCHEMA_NOTES:
[List any schema markup opportunities: FAQ schema sections, LocalBusiness signals, HowTo, etc.]

TRUST_SIGNALS_USED:
[List what trust signals you included: named professional, credential, review reference, years operating, etc. If none available from client profile, flag it as a gap.]

INTERNAL_LINKS:
[List every internal link used: anchor text → target URL or target page name. No placeholder links.]

CONTENT:
[The full article. H2 and H3 headings in markdown. Primary keyword in H1 equivalent, first 100 words, and at least one H2. Local area mentioned within first 200 words. Ends with a specific, low-friction CTA naming the service and location.]`
}

// ─── Parse structured output ──────────────────────────────────────────────────

function parseOutput(text, task) {
  const extract = (field) => {
    const match = text.match(new RegExp(`^${field}:\\s*(.+?)(?=\\n[A-Z_]+:|$)`, "ms"))
    return match ? match[1].trim() : null
  }

  const title = extract("TITLE_TAG")
  const metaDescription = extract("META_DESCRIPTION")
  const h1 = extract("H1")
  const contentMatch = text.match(/^CONTENT:\n([\s\S]+)/m)
  const content = contentMatch ? contentMatch[1].trim() : text

  const wordCount = content.split(/\s+/).length

  // Build notes from the structured fields
  const snippetBlock = extract("SNIPPET_BLOCK")
  const schemaNotes = extract("SCHEMA_NOTES")
  const trustSignals = extract("TRUST_SIGNALS_USED")
  const internalLinks = extract("INTERNAL_LINKS")

  const notes = [
    snippetBlock ? `SNIPPET BLOCK:\n${snippetBlock}` : null,
    schemaNotes ? `SCHEMA NOTES:\n${schemaNotes}` : null,
    trustSignals ? `TRUST SIGNALS:\n${trustSignals}` : null,
    internalLinks ? `INTERNAL LINKS:\n${internalLinks}` : null,
  ].filter(Boolean).join("\n\n")

  return {
    title: title || h1 || `Draft: ${task.primary_keyword}`,
    meta_description: metaDescription,
    content,
    word_count: wordCount,
    primary_keyword: task.primary_keyword,
    notes: notes || null,
  }
}

// ─── Save output and update queue ────────────────────────────────────────────

async function saveOutput(task, parsed) {
  const userId = task.user_id || await getOwnerUserId();
  const { data: output, error: outputError } = await supabase
    .from("content_outputs")
    .insert({
      client_id: task.client_id,
      queue_item_id: task.id,
      agent_type: task.agent_type || "seo",
      title: parsed.title,
      content: parsed.content,
      primary_keyword: parsed.primary_keyword,
      meta_description: parsed.meta_description,
      word_count: parsed.word_count,
      notes: parsed.notes,
      user_id: userId,
    })
    .select()
    .single();

  if (outputError) throw new Error("Failed to save output: " + outputError.message);

  await supabase
    .from("content_queue")
    .update({ status: "review", output_id: output.id })
    .eq("id", task.id);

  return output;
}

// ─── Main run loop ────────────────────────────────────────────────────────────

async function runTask(task) {
  const client = task.client_profiles;
  console.log(`[${new Date().toISOString()}] Running: "${task.primary_keyword}" for ${client.name}`);

  await supabase.from("content_queue").update({ status: "running" }).eq("id", task.id);

  try {
    const context = await getClientContext(task.client_id, task.primary_keyword);
    const systemPrompt = buildSystemPrompt(client);
    const taskPrompt = buildTaskPrompt(task, client, context);

    const message = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: taskPrompt }],
    });

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const parsed = parseOutput(text, task);
    const output = await saveOutput(task, parsed);

    console.log(`[${new Date().toISOString()}] Done: "${parsed.title}" (${parsed.word_count} words) → output ${output.id}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Failed:`, err.message);
    await supabase
      .from("content_queue")
      .update({ status: "failed", error: err.message })
      .eq("id", task.id);
  }
}

// ─── Scheduled publish ───────────────────────────────────────────────────────

async function publishScheduled() {
  const { data: outputs } = await supabase
    .from("content_outputs")
    .select("*, client_profiles(*)")
    .eq("approved", true)
    .not("scheduled_publish_at", "is", null)
    .is("published_url", null)
    .lte("scheduled_publish_at", new Date().toISOString());

  if (!outputs?.length) return;

  for (const output of outputs) {
    try {
      const client = output.client_profiles;
      if (!client?.github_repo) continue;

      const slug = `content/blog/${output.primary_keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.md`;
      const frontmatter = [
        "---",
        `title: "${(output.title || output.primary_keyword).replace(/"/g, "'")}"`,
        output.meta_description ? `description: "${output.meta_description.replace(/"/g, "'")}"` : "",
        output.primary_keyword ? `keyword: "${output.primary_keyword}"` : "",
        `date: "${new Date().toISOString().split("T")[0]}"`,
        "---",
      ].filter(Boolean).join("\n");
      const fileContent = `${frontmatter}\n\n${output.content}`;

      // Get existing file SHA if it exists
      const [owner, repo] = client.github_repo.replace("https://github.com/", "").split("/");
      const shaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${slug}`, {
        headers: { Authorization: `token ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
      });
      const shaData = shaRes.ok ? await shaRes.json() : null;

      const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${slug}`, {
        method: "PUT",
        headers: { Authorization: `token ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Scheduled publish: ${output.title || output.primary_keyword}`,
          content: Buffer.from(fileContent).toString("base64"),
          ...(shaData?.sha ? { sha: shaData.sha } : {}),
        }),
      });

      if (commitRes.ok) {
        const commitData = await commitRes.json();
        const publishedUrl = commitData.content?.html_url || null;
        await supabase.from("content_outputs").update({ published_url: publishedUrl, scheduled_publish_at: null }).eq("id", output.id);
        console.log(`[${new Date().toISOString()}] Scheduled publish: "${output.title}" → ${slug}`);
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Scheduled publish failed for output ${output.id}:`, err.message);
    }
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

async function tick() {
  const task = await getNextTask();
  if (!task) return;
  await runTask(task);
}

cron.schedule("*/5 * * * *", tick);
cron.schedule("*/5 * * * *", publishScheduled);
tick();
publishScheduled();

console.log("SEO agent worker running. Checking queue and scheduled publishes every 5 minutes.");
