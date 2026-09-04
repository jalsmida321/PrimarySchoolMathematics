<template>
  <el-card class="ai-card" shadow="never">
    <template #header><strong>AI 一句话出题</strong></template>
    <el-input v-model="prompt" type="textarea" :rows="3" maxlength="500" show-word-limit
      placeholder="例：给一年级出30道20以内进位加法，A4三列，附答案" />
    <el-input v-model="baseUrl" class="key-input" clearable
      placeholder="中转站 URL，例如 https://api.pinniq.org/v1" />
    <el-input v-model="apiKey" class="key-input" type="password" show-password clearable
      placeholder="Pinniq API Key（仅保存在本次浏览器会话）" />
    <div class="model-row">
      <el-select v-model="modelId" clearable filterable placeholder="可选：选择模型" :loading="modelsLoading">
        <el-option v-for="model in models" :key="model.id" :label="model.name" :value="model.id" />
      </el-select>
      <el-button :loading="modelsLoading" :disabled="!apiKey.trim()" @click="loadModels">加载模型</el-button>
    </div>
    <div class="ai-actions">
      <el-button type="primary" :loading="loading" :disabled="!prompt.trim() || !apiKey.trim()" @click="generate">AI 生成试卷</el-button>
      <el-button link @click="openPinniq">获取 Pinniq Key</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
    <el-alert v-if="success" :title="success" type="success" show-icon :closable="false" />
  </el-card>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";

const prompt = ref("");
const apiKey = ref("");
const baseUrl = ref(sessionStorage.getItem("pinniq-base-url") || "https://api.pinniq.org/v1");
const modelId = ref(sessionStorage.getItem("pinniq-model") || "");
const models = ref([]);
const modelsLoading = ref(false);
const loading = ref(false);
const error = ref("");
const success = ref("");
const router = useRouter();
const appStore = useAppStore();

onMounted(() => {
  apiKey.value = sessionStorage.getItem("pinniq-api-key") || "";
});

const openPinniq = () => window.open("https://api.pinniq.org", "_blank", "noopener");

const loadModels = async () => {
  modelsLoading.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/ai/models", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: apiKey.value.trim(), baseUrl: baseUrl.value.trim() }),
    });
    const text = await response.text();
    let result;
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`模型列表返回了非 JSON 响应（HTTP ${response.status}）：${text.slice(0, 300)}`);
    }
    if (!response.ok) throw new Error(result.error || `模型列表请求失败（HTTP ${response.status}）`);
    models.value = result.models || [];
    if (!models.value.length) throw new Error("中转站没有返回可用模型，请检查 API 根地址和 Key");
    if (!models.value.some(model => model.id === modelId.value)) modelId.value = models.value[0].id;
    sessionStorage.setItem("pinniq-model", modelId.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    modelsLoading.value = false;
  }
};

const generate = async () => {
  loading.value = true;
  error.value = "";
  success.value = "";
  sessionStorage.setItem("pinniq-api-key", apiKey.value.trim());
  sessionStorage.setItem("pinniq-base-url", baseUrl.value.trim());
  sessionStorage.setItem("pinniq-model", modelId.value);
  try {
    const response = await fetch("/api/ai/worksheet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: prompt.value.trim(), apiKey: apiKey.value.trim(), baseUrl: baseUrl.value.trim(), modelId: modelId.value }),
    });
    // 先读文本再解析，避免后端崩溃/代理返回空响应时只看到 JSON 解析错误。
    const responseText = await response.text();
    let result = null;
    try {
      result = responseText ? JSON.parse(responseText) : null;
    } catch {
      throw new Error(`服务返回了非 JSON 响应（HTTP ${response.status}）：${responseText.slice(0, 200)}`);
    }
    if (!response.ok) throw new Error(result?.error || `AI 出题失败（HTTP ${response.status}）`);
    if (!result?.plan || !Array.isArray(result.papers)) throw new Error("服务返回的数据不完整");
    appStore.navigateToPrint(router, result.plan.paperTitle, result.papers);
    success.value = "已生成并打开试卷预览";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.ai-card { margin-bottom: 24px; border: 1px solid #b3d8ff; }
.key-input { margin-top: 12px; }
.model-row { display: flex; gap: 8px; margin-top: 12px; }
.model-row .el-select { flex: 1; }
.ai-actions { display: flex; align-items: center; margin: 12px 0; }
.el-alert { margin-top: 8px; }
</style>
