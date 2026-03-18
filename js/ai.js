/**
 * ai.js – Natural language medication parser and AI chat for 用药助手
 *
 * Provider: GitHub Copilot (GitHub Models API) or any OpenAI-compatible endpoint
 * Model: configurable via cfg.apiModel; falls back to GITHUB_AI_MODEL constant.
 * Falls back to rule-based parser when no API key is present.
 */

/* ── Default GitHub Copilot / GitHub Models configuration ── */
const GITHUB_AI_BASE_URL = 'https://models.inference.ai.azure.com';
/* Default model via GitHub Models */
const GITHUB_AI_MODEL    = 'gemini-3-flash';

/* ── Preset third-party provider configurations ── */
const AI_PRESETS = {
  github: {
    label:   'GitHub Copilot',
    baseUrl: 'https://models.inference.ai.azure.com',
    model:   'gemini-3-flash'
  },
  aliyun: {
    label:   '阿里云百炼 (DeepSeek)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model:   'deepseek-v3.2'
  },
  custom: {
    label:   '自定义 OpenAI 兼容接口',
    baseUrl: '',
    model:   ''
  }
};

const AI = {
  /**
   * Parse a natural language medication prescription.
   * Returns an array of partial Medication objects (one per drug found).
   * @param {string} text  – raw user input
   * @param {object} cfg   – { apiBaseUrl, apiKey, apiModel }
   * @returns {Promise<Array<object>>}
   */
  async parse(text, cfg = {}) {
    if (cfg.apiKey && cfg.apiKey.trim()) {
      try {
        return await AI._callLLM(text, cfg);
      } catch (err) {
        console.warn('AI API failed, falling back to rule-based parser:', err.message);
      }
    }
    return AI._ruleBased(text);
  },

  /**
   * Multi-turn chat with the AI model.
   * @param {Array<{role:string, content:string}>} messages – conversation history
   * @param {string} apiKey – API key / token
   * @param {object} cfg – { apiBaseUrl, apiModel } (optional, falls back to GitHub defaults)
   * @returns {Promise<string>} assistant reply
   */
  async chat(messages, apiKey, cfg = {}) {
    if (!apiKey || !apiKey.trim()) {
      throw new Error('请先在设置中配置 API Key');
    }
    const baseUrl = (cfg.apiBaseUrl && cfg.apiBaseUrl.trim()) ? cfg.apiBaseUrl.trim() : GITHUB_AI_BASE_URL;
    const model   = (cfg.apiModel   && cfg.apiModel.trim())   ? cfg.apiModel.trim()   : GITHUB_AI_MODEL;
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens:  800
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`API ${resp.status}: ${err}`);
    }

    const json = await resp.json();
    return json.choices?.[0]?.message?.content || '';
  },

  /* ── LLM via configurable OpenAI-compatible endpoint ── */
  async _callLLM(text, cfg) {
    const baseUrl = (cfg.apiBaseUrl && cfg.apiBaseUrl.trim()) ? cfg.apiBaseUrl.trim() : GITHUB_AI_BASE_URL;
    const model   = (cfg.apiModel   && cfg.apiModel.trim())   ? cfg.apiModel.trim()   : GITHUB_AI_MODEL;

    const systemPrompt = `你是一个药品信息提取助手。从用户输入的自然语言药单中提取所有药品的结构化信息，返回 JSON 数组格式（即使只有一种药品也返回数组）。每个药品对象的字段说明：
- name: 药品名称（字符串）
- dose: 每次剂量数字（数字，如 2；若为半片则为 0.5）
- unit: 剂量单位（片/粒/ml/mg/袋/支，默认"片"）
- times: 每天服药时间数组，格式 "HH:MM"（如 ["07:00","12:00","18:00"]）
- quantity: 现有总数量（数字，没有则为 0）
- notes: 备注说明（字符串，如特殊用法、减量方案等）

常见时间映射：早上/早餐→07:00，中午/午餐→12:00，晚上/晚餐→18:00，睡前→22:00，每天三次→["07:00","12:00","18:00"]，每天两次→["08:00","20:00"]，每天一次→["08:00"]，隔日一次→["08:00"]（备注中注明隔日服用）。

重要：药单中有多少种药品就提取多少个对象，不得遗漏任何一种。只返回 JSON 数组，不要任何解释。示例：[{"name":"药品A","dose":1,"unit":"片","times":["08:00"],"quantity":0,"notes":""}]`;

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: text }
        ],
        temperature: 0.1,
        max_tokens:  2000
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`API ${resp.status}: ${err}`);
    }

    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content || '';
    // Extract JSON from the response (strip markdown code blocks if present)
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    const objMatch   = content.match(/\{[\s\S]*\}/);
    const rawJson    = arrayMatch ? arrayMatch[0] : (objMatch ? objMatch[0] : null);
    if (!rawJson) throw new Error('AI 未返回可识别的 JSON 格式，请检查 API 配置或手动填写');
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (parseErr) {
      throw new Error('AI 返回的 JSON 格式无效：' + parseErr.message);
    }
    // Normalise: always return an array
    return Array.isArray(parsed) ? parsed : [parsed];
  },

  /* ── Rule-based fallback parser (Chinese) ── */
  _ruleBased(text) {
    const result = {
      name:     '',
      dose:     1,
      unit:     '片',
      times:    [],
      quantity: 0,
      notes:    ''
    };

    /* ── Name: first Chinese word sequence before dose/frequency info ── */
    const nameMatch = text.match(/^[\u4e00-\u9fa5a-zA-Z0-9·]+/);
    if (nameMatch) result.name = nameMatch[0].trim();

    /* ── Dose ── */
    const dosePatterns = [
      /每次(\d+\.?\d*)\s*(片|粒|ml|mg|袋|支|瓶)/,
      /(\d+\.?\d*)\s*(片|粒|ml|mg|袋|支|瓶)/,
    ];
    for (const pat of dosePatterns) {
      const m = text.match(pat);
      if (m) { result.dose = parseFloat(m[1]); result.unit = m[2]; break; }
    }

    /* ── Unit alone ── */
    const unitMatch = text.match(/(片|粒|ml|mg|袋|支|瓶)/);
    if (unitMatch && result.unit === '片') result.unit = unitMatch[1];

    /* ── Quantity ── */
    const qtyPatterns = [
      /共(\d+)\s*(片|粒|ml|mg|袋|支|瓶)/,
      /(\d+)\s*(片|粒|ml|mg|袋|支|瓶)\s*[，,]?\s*共/,
      /总共(\d+)/,
    ];
    for (const pat of qtyPatterns) {
      const m = text.match(pat);
      if (m) { result.quantity = parseInt(m[1]); break; }
    }

    /* ── Times ── */
    const timeMap = {
      '每天三次':  ['07:00', '12:00', '18:00'],
      '一日三次':  ['07:00', '12:00', '18:00'],
      '每日三次':  ['07:00', '12:00', '18:00'],
      '每天两次':  ['08:00', '20:00'],
      '一日两次':  ['08:00', '20:00'],
      '每日两次':  ['08:00', '20:00'],
      '每天一次':  ['08:00'],
      '一日一次':  ['08:00'],
      '每日一次':  ['08:00'],
      '每天四次':  ['07:00', '11:00', '15:00', '21:00'],
    };
    for (const [kw, times] of Object.entries(timeMap)) {
      if (text.includes(kw)) { result.times = [...times]; break; }
    }

    /* specific time mentions override */
    const specificTimes = [];
    if (/(早上|早餐|早饭|晨)/.test(text)) specificTimes.push('07:00');
    if (/(中午|午餐|午饭)/.test(text))   specificTimes.push('12:00');
    if (/(晚上|晚餐|晚饭)/.test(text))   specificTimes.push('18:00');
    if (/(睡前|睡觉前)/.test(text))      specificTimes.push('22:00');
    if (specificTimes.length) result.times = specificTimes;

    /* explicit HH:MM */
    const hhmm = text.match(/\b([01]?\d|2[0-3])[:：]([0-5]\d)\b/g);
    if (hhmm && hhmm.length) {
      result.times = hhmm.map((t) => t.replace('：', ':').padStart(5, '0'));
    }

    /* default: three times a day */
    if (!result.times.length) result.times = ['07:00', '12:00', '18:00'];

    /* ── Notes ── */
    const notesPatterns = [
      /(饭后|饭前|餐后|餐前|空腹)[^\s，,。；;]*服?用?/,
      /不[能可以]+与[^\s，,。；;]+同[服用]+/,
      /注意[：:][^\s，,。；;]*/,
    ];
    const notesParts = [];
    for (const pat of notesPatterns) {
      const m = text.match(pat);
      if (m) notesParts.push(m[0]);
    }
    result.notes = notesParts.join('；');

    return [result];
  }
};
