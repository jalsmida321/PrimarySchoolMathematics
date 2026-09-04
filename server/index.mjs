import http from "node:http";
import path from "node:path";
import { DefaultResourceLoader, ModelRuntime, SessionManager, createAgentSession } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFormulasGenerator } from "../src/utils/paperGenerator.js";

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || "127.0.0.1";
const PINNIQ_BASE_URL = (process.env.PINNIQ_BASE_URL || "https://api.pinniq.org/v1").replace(/\/$/, "");
const DEFAULT_MODEL = process.env.PINNIQ_DEFAULT_MODEL || "";
const ALLOWED_PROVIDER_HOSTS = (process.env.ALLOWED_PROVIDER_HOSTS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);

function explainProviderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("AllocationQuota.FreeTierOnly") || message.includes("Free quota exhausted")) {
    return "中转站返回 403：当前模型免费额度已用完，且管理后台启用了“仅免费额度”模式。请在中转站后台充值/分配付费额度，关闭 use free tier only，或改用仍有额度的模型。也可以设置 PINNIQ_DEFAULT_MODEL 指定模型。";
  }
  if (message.includes("Invalid token") || message.includes("401")) {
    return "中转站返回 401：API Key 无效、过期，或该 Key 不属于当前中转站。请重新复制 Key，并确认 URL 与 Key 来自同一个中转站。";
  }
  if (message.includes("model") && (message.includes("not found") || message.includes("does not exist"))) {
    return "中转站返回模型不存在：请检查 PINNIQ_DEFAULT_MODEL，或确认中转站 /models 返回的模型 ID。";
  }
  return message;
}

const SYSTEM_PROMPT = `你是小学口算出题配置助手。你不能直接生成题目或答案，只能把用户要求转换成 JSON。
只输出 JSON，不要 Markdown，格式为：
{"paperTitle":"小学生口算题","numberOfPapers":1,"numberOfPagerColumns":3,"solution":"0","enableBrackets":false,"carry":"1","abdication":"1","remainder":"2","seed":"ai-generated","sections":[{"step":1,"numberOfFormulas":20,"whereIsResult":"0","formulaList":[{"min":1,"max":9,"operators":null},{"min":1,"max":9,"operators":[1]}],"resultMinValue":1,"resultMaxValue":18}]}
规则：step 只能是 1、2、3；每个 section 的 formulaList 长度必须是 step+1；operators 使用 1=加、2=减、3=乘、4=除；numberOfFormulas 不超过 100；不要添加 schema 外字段。`;

function jsonResponse(response, status, data) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => { body += chunk; if (body.length > 100_000) reject(new Error("请求过大")); });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label}返回了非 JSON 响应（HTTP ${response.status}）：${text.slice(0, 300)}`);
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || text || `HTTP ${response.status}`;
    throw new Error(`${label}失败：${message}`);
  }
  return payload;
}

function resolveBaseUrl(value) {
  const candidate = String(value || PINNIQ_BASE_URL).trim().replace(/\/$/, "");
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("中转站 URL 必须使用 http 或 https");
  if (url.username || url.password) throw new Error("中转站 URL 不能包含用户名或密码");
  if (ALLOWED_PROVIDER_HOSTS.length > 0 && !ALLOWED_PROVIDER_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new Error("该中转站域名不在服务端允许列表中");
  }
  return candidate;
}

async function listModels(apiKey, baseUrl) {
  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });
  const payload = await readJsonResponse(response, "中转站模型列表请求");
  // 兼容 OpenAI、部分 New API/One API 及自定义中转站的返回格式。
  const rawModels = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload?.result)
          ? payload.result
          : [];
  return rawModels
    .map(model => {
      if (typeof model === "string") return { id: model, name: model };
      const id = model?.id || model?.model || model?.name;
      return id ? { ...model, id: String(id), name: String(model.name || id) } : null;
    })
    .filter(Boolean);
}

function normalizePlan(plan) {
  if (!plan || !Array.isArray(plan.sections) || plan.sections.length === 0) throw new Error("AI 没有返回有效题型配置");
  const sections = plan.sections.map(section => {
    const step = Number(section.step);
    if (![1, 2, 3].includes(step)) throw new Error("AI 返回了无效的运算步数");
    const formulaList = section.formulaList?.slice(0, step + 1);
    if (!formulaList || formulaList.length !== step + 1) throw new Error("AI 返回的算数项数量与步数不匹配");
    return { ...section, step, numberOfFormulas: Math.min(100, Math.max(1, Number(section.numberOfFormulas))), formulaList };
  });
  return {
    paperTitle: String(plan.paperTitle || "小学生口算题").slice(0, 60),
    paperSubTitle: "姓名：__________ 日期：____月____日 时间：________",
    numberOfPapers: Math.min(10, Math.max(1, Number(plan.numberOfPapers || 1))),
    numberOfPagerColumns: Math.min(6, Math.max(1, Number(plan.numberOfPagerColumns || 3))),
    solution: plan.solution === "1" ? "1" : "0",
    enableBrackets: Boolean(plan.enableBrackets),
    carry: String(plan.carry || "1"), abdication: String(plan.abdication || "1"), remainder: String(plan.remainder || "2"),
    seed: String(plan.seed || "ai-generated"), sections,
  };
}

async function makePlan(apiKey, requestText, baseUrl, requestedModelId = "") {
  const models = await listModels(apiKey, baseUrl);
  if (models.length === 0) throw new Error("当前中转站没有返回可用模型");
  const preferredModel = requestedModelId || DEFAULT_MODEL;
  const modelId = preferredModel && models.some(model => model.id === preferredModel) ? preferredModel : models[0].id;
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore() });
  modelRuntime.registerProvider("pinniq", {
    name: "Pinniq AI",
    baseUrl,
    api: "openai-completions",
    apiKey,
    models: models.map(model => ({
      id: model.id,
      name: model.id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.context_window || 128000,
      maxTokens: model.max_tokens || 4096,
    })),
  });
  const model = modelRuntime.getModel("pinniq", modelId);
  if (!model) throw new Error("无法选择 Pinniq 模型");
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: path.join(process.cwd(), ".pi-agent"),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: SYSTEM_PROMPT,
  });
  await loader.reload();
  const { session } = await createAgentSession({
    model,
    modelRuntime,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    tools: [],
  });
  let streamedText = "";
  let finalAssistantMessage = null;
  session.subscribe(event => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") streamedText += event.assistantMessageEvent.delta;
    if (event.type === "message_end" && event.message.role === "assistant") finalAssistantMessage = event.message;
  });
  try {
    await session.prompt(requestText);
  } finally {
    session.dispose();
  }
  const finalText = Array.isArray(finalAssistantMessage?.content)
    ? finalAssistantMessage.content.filter(block => block.type === "text").map(block => block.text).join("")
    : "";
  const text = (streamedText || finalText).trim();
  if (!text) {
    const reason = finalAssistantMessage?.errorMessage || finalAssistantMessage?.stopReason || "中转站没有返回文本";
    throw new Error(`AI 未返回文本：${reason}。请检查中转站 URL、模型兼容性和 API Key。`);
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error(`AI 返回了文本，但其中没有 JSON 配置：${text.slice(0, 300)}`);
  }
  try {
    return normalizePlan(JSON.parse(text.slice(start, end + 1)));
  } catch (error) {
    throw new Error(`AI 返回的 JSON 配置无效：${error instanceof Error ? error.message : String(error)}；原文：${text.slice(start, Math.min(text.length, start + 500))}`);
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return jsonResponse(response, 204, {});
  if (request.method === "GET" && request.url === "/healthz") return jsonResponse(response, 200, { ok: true });
  if (request.method !== "POST" || !["/api/ai/worksheet", "/api/ai/models"].includes(request.url)) return jsonResponse(response, 404, { error: "Not found" });
  try {
    const body = JSON.parse(await readBody(request));
    const apiKey = String(body.apiKey || "").trim();
    if (!apiKey) return jsonResponse(response, 400, { error: "请提供中转站 API Key" });
    const baseUrl = resolveBaseUrl(body.baseUrl);
    if (request.url === "/api/ai/models") {
      const models = await listModels(apiKey, baseUrl);
      if (models.length === 0) throw new Error("中转站请求成功，但 /models 没有返回可识别的模型。请检查该地址是否为 API 根地址，并确认返回包含 data、models 或数组字段。");
      return jsonResponse(response, 200, { models: models.map(model => ({ id: model.id, name: model.name || model.id })) });
    }
    const plan = await makePlan(apiKey, String(body.prompt || ""), baseUrl, String(body.modelId || ""));
    const papers = createFormulasGenerator({ ...plan, numberOfPapers: plan.numberOfPapers }, plan.sections);
    return jsonResponse(response, 200, { plan, papers });
  } catch (error) {
    return jsonResponse(response, 400, { error: explainProviderError(error) });
  }
});

server.listen(PORT, HOST, () => console.log(`Primary Math AI server listening on http://${HOST}:${PORT}`));
