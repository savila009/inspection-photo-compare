const STORAGE_KEY = "inspectionCompare.ai.v1";

export function defaultAiSettings() {
  return {
    provider: "claude",
    apiKey: "",
    rememberKey: true,
  };
}

export function loadAiSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultAiSettings();
    }
    const parsed = JSON.parse(raw);
    return {
      ...defaultAiSettings(),
      provider: parsed.provider === "openai" ? "openai" : "claude",
      rememberKey: parsed.rememberKey !== false,
      apiKey: parsed.rememberKey === false ? "" : String(parsed.apiKey || ""),
    };
  } catch {
    return defaultAiSettings();
  }
}

export function saveAiSettings(settings) {
  const payload = {
    provider: settings.provider === "openai" ? "openai" : "claude",
    rememberKey: settings.rememberKey !== false,
    apiKey: settings.rememberKey === false ? "" : String(settings.apiKey || "").trim(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function readAiSettingsFromUi(apiKeyEl, visionProviderEl, rememberKeyEl) {
  return {
    provider: visionProviderEl?.value === "openai" ? "openai" : "claude",
    apiKey: apiKeyEl?.value?.trim() || "",
    rememberKey: rememberKeyEl ? rememberKeyEl.checked : true,
  };
}

export function applyAiSettingsToUi(settings, apiKeyEl, visionProviderEl, rememberKeyEl) {
  if (visionProviderEl) {
    visionProviderEl.value = settings.provider;
  }
  if (rememberKeyEl) {
    rememberKeyEl.checked = settings.rememberKey !== false;
  }
  if (apiKeyEl) {
    apiKeyEl.value = settings.rememberKey === false ? "" : settings.apiKey || "";
  }
}

export function serverHasKeyForProvider(serverConfig, provider) {
  return Boolean(serverConfig?.keysConfigured?.[provider]);
}

export function visionIsReady(serverAvailable, serverConfig, provider, clientApiKey) {
  if (!serverAvailable) {
    return false;
  }
  if (serverHasKeyForProvider(serverConfig, provider)) {
    return true;
  }
  return Boolean(String(clientApiKey || "").trim());
}

export function describeKeySource(serverConfig, provider, clientApiKey) {
  if (serverHasKeyForProvider(serverConfig, provider)) {
    return "Using API key configured on the server (environment variable).";
  }
  if (String(clientApiKey || "").trim()) {
    return "Using API key saved in this browser.";
  }
  return "Set ANTHROPIC_API_KEY or OPENAI_API_KEY when running npm start, or enter a key below.";
}
