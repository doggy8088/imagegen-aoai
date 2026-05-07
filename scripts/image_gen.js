#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Blob } from "node:buffer";

const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
const DEFAULT_SIZE = "auto";
const DEFAULT_QUALITY = "medium";
const DEFAULT_OUTPUT_FORMAT = "png";
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_DOWNSCALE_SUFFIX = "-web";
const DEFAULT_OUTPUT_PATH = "output/imagegen/output.png";
const GPT_IMAGE_MODEL_PREFIX = "gpt-image-";
const GPT_IMAGE_2_MODEL = "gpt-image-2";
const GPT_IMAGE_2_MIN_PIXELS = 655_360;
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400;
const GPT_IMAGE_2_MAX_EDGE = 3840;
const GPT_IMAGE_2_MAX_RATIO = 3.0;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_BATCH_JOBS = 500;

function die(message, code = 1) {
  console.error(`Error: ${message}`);
  process.exit(code);
}

function warn(message) {
  console.error(`Warning: ${message}`);
}

function parseInteger(value, label) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) return Number.parseInt(value, 10);
  die(`${label} must be an integer`);
}

function azureApiVersion() {
  return process.env.AZURE_OPENAI_API_VERSION
    || process.env.OPENAI_API_VERSION
    || DEFAULT_AZURE_OPENAI_API_VERSION;
}

function defaultModel() {
  return process.env.AZURE_OPENAI_IMAGE_DEPLOYMENT || DEFAULT_MODEL;
}

function ensureApiKey(dryRun) {
  const missing = ["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY"].filter((name) => !process.env[name]);
  if (missing.length === 0) {
    console.error(`Azure OpenAI environment is set (api-version ${azureApiVersion()}).`);
    return;
  }
  if (dryRun) {
    warn(`${missing.join(", ")} not set; dry-run only.`);
    return;
  }
  die(`${missing.join(", ")} not set. Export them before running.`);
}

function readPrompt(prompt, promptFile) {
  if (prompt && promptFile) die("Use --prompt or --prompt-file, not both.");
  if (promptFile) {
    if (!fs.existsSync(promptFile)) die(`Prompt file not found: ${promptFile}`);
    return fs.readFileSync(promptFile, "utf8").trim();
  }
  if (prompt) return prompt.trim();
  die("Missing prompt. Use --prompt or --prompt-file.");
}

function checkImagePaths(paths) {
  return paths.map((raw) => {
    if (!fs.existsSync(raw)) die(`Image file not found: ${raw}`);
    if (fs.statSync(raw).size > MAX_IMAGE_BYTES) warn(`Image exceeds 50MB limit: ${raw}`);
    return raw;
  });
}

function normalizeOutputFormat(fmt) {
  if (!fmt) return DEFAULT_OUTPUT_FORMAT;
  const value = String(fmt).toLowerCase();
  if (!["png", "jpeg", "jpg", "webp"].includes(value)) {
    die("output-format must be png, jpeg, jpg, or webp.");
  }
  return value === "jpg" ? "jpeg" : value;
}

function parseSize(size) {
  const match = String(size).match(/^([1-9][0-9]*)x([1-9][0-9]*)$/);
  return match ? [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)] : null;
}

function validateGptImage2Size(size) {
  if (size === "auto") return;
  const parsed = parseSize(size);
  if (!parsed) die("size must be auto or WIDTHxHEIGHT, for example 1024x1024.");
  const [width, height] = parsed;
  const maxEdge = Math.max(width, height);
  const minEdge = Math.min(width, height);
  const totalPixels = width * height;
  if (maxEdge > GPT_IMAGE_2_MAX_EDGE) {
    die("gpt-image-2 size maximum edge length must be less than or equal to 3840px.");
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    die("gpt-image-2 size width and height must be multiples of 16px.");
  }
  if (maxEdge / minEdge > GPT_IMAGE_2_MAX_RATIO) {
    die("gpt-image-2 size long edge to short edge ratio must not exceed 3:1.");
  }
  if (totalPixels < GPT_IMAGE_2_MIN_PIXELS || totalPixels > GPT_IMAGE_2_MAX_PIXELS) {
    die("gpt-image-2 size total pixels must be at least 655,360 and no more than 8,294,400.");
  }
}

function validateSize(size, model) {
  if (model === GPT_IMAGE_2_MODEL) {
    validateGptImage2Size(size);
    return;
  }
  if (!model.startsWith(GPT_IMAGE_MODEL_PREFIX)) {
    if (size === "auto" || parseSize(size)) return;
    die("size must be auto or WIDTHxHEIGHT, for example 1024x1024.");
  }
  if (!["1024x1024", "1536x1024", "1024x1536", "auto"].includes(size)) {
    die("size must be one of 1024x1024, 1536x1024, 1024x1536, or auto for this GPT Image model.");
  }
}

function validateQuality(quality) {
  if (!["low", "medium", "high", "auto"].includes(quality)) {
    die("quality must be one of low, medium, high, or auto.");
  }
}

function validateBackground(background) {
  if (![undefined, null, "transparent", "opaque", "auto"].includes(background)) {
    die("background must be one of transparent, opaque, or auto.");
  }
}

function validateInputFidelity(inputFidelity) {
  if (![undefined, null, "low", "high"].includes(inputFidelity)) {
    die("input-fidelity must be one of low or high.");
  }
}

function validateModel(model) {
  if (!String(model).trim()) die("model must be an Azure OpenAI image deployment name.");
}

function validateTransparency(background, outputFormat) {
  if (background === "transparent" && !["png", "webp"].includes(outputFormat)) {
    die("transparent background requires output-format png or webp.");
  }
}

function validateModelSpecificOptions({ model, background, inputFidelity = null }) {
  if (model !== GPT_IMAGE_2_MODEL) return;
  if (background === "transparent") {
    die("transparent backgrounds are not supported in gpt-image-2, the latest model. Use --model gpt-image-1.5 --background transparent --output-format png instead.");
  }
  if (inputFidelity !== null && inputFidelity !== undefined) {
    die("input_fidelity is not supported in gpt-image-2 because image inputs always use high fidelity for this model.");
  }
}

function validateGeneratePayload(payload) {
  const model = String(payload.model ?? DEFAULT_MODEL);
  validateModel(model);
  const n = parseInteger(payload.n ?? 1, "n");
  if (n < 1 || n > 10) die("n must be between 1 and 10");
  validateSize(String(payload.size ?? DEFAULT_SIZE), model);
  validateQuality(String(payload.quality ?? DEFAULT_QUALITY));
  validateBackground(payload.background);
  validateModelSpecificOptions({ model, background: payload.background });
  if (payload.output_compression !== undefined && payload.output_compression !== null) {
    const value = parseInteger(payload.output_compression, "output_compression");
    if (value < 0 || value > 100) die("output_compression must be between 0 and 100");
  }
}

function withSuffix(filePath, ext) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${ext}`);
}

function buildOutputPaths(out, outputFormat, count, outDir) {
  const ext = `.${outputFormat}`;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    return Array.from({ length: count }, (_, idx) => path.join(outDir, `image_${idx + 1}${ext}`));
  }
  let outPath = out;
  if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) {
    fs.mkdirSync(outPath, { recursive: true });
    return Array.from({ length: count }, (_, idx) => path.join(outPath, `image_${idx + 1}${ext}`));
  }
  const currentExt = path.extname(outPath);
  if (!currentExt) {
    outPath = withSuffix(outPath, ext);
  } else if (currentExt.slice(1).toLowerCase() !== outputFormat) {
    warn(`Output extension ${currentExt} does not match output-format ${outputFormat}.`);
  }
  if (count === 1) return [outPath];
  const parsed = path.parse(outPath);
  return Array.from({ length: count }, (_, idx) => path.join(parsed.dir, `${parsed.name}-${idx + 1}${parsed.ext}`));
}

function fieldsFromArgs(args) {
  return {
    use_case: args.useCase,
    scene: args.scene,
    subject: args.subject,
    style: args.style,
    composition: args.composition,
    lighting: args.lighting,
    palette: args.palette,
    materials: args.materials,
    text: args.text,
    constraints: args.constraints,
    negative: args.negative,
  };
}

function augmentPromptFields(augment, prompt, fields) {
  if (!augment) return prompt;
  const sections = [];
  if (fields.use_case) sections.push(`Use case: ${fields.use_case}`);
  sections.push(`Primary request: ${prompt}`);
  if (fields.scene) sections.push(`Scene/background: ${fields.scene}`);
  if (fields.subject) sections.push(`Subject: ${fields.subject}`);
  if (fields.style) sections.push(`Style/medium: ${fields.style}`);
  if (fields.composition) sections.push(`Composition/framing: ${fields.composition}`);
  if (fields.lighting) sections.push(`Lighting/mood: ${fields.lighting}`);
  if (fields.palette) sections.push(`Color palette: ${fields.palette}`);
  if (fields.materials) sections.push(`Materials/textures: ${fields.materials}`);
  if (fields.text) sections.push(`Text (verbatim): "${fields.text}"`);
  if (fields.constraints) sections.push(`Constraints: ${fields.constraints}`);
  if (fields.negative) sections.push(`Avoid: ${fields.negative}`);
  return sections.join("\n");
}

function augmentPrompt(args, prompt) {
  return augmentPromptFields(args.augment, prompt, fieldsFromArgs(args));
}

function sortForJson(value) {
  if (Array.isArray(value)) return value.map(sortForJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortForJson(value[key])]));
  }
  return value;
}

function printRequest(payload) {
  console.log(JSON.stringify(sortForJson(payload), null, 2));
}

function decodeWriteAndDownscale(images, outputs, { force, downscaleMaxDim, downscaleSuffix, outputFormat }) {
  return Promise.all(images.slice(0, outputs.length).map(async (imageB64, idx) => {
    const outPath = outputs[idx];
    if (fs.existsSync(outPath) && !force) die(`Output already exists: ${outPath} (use --force to overwrite)`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const raw = Buffer.from(imageB64, "base64");
    fs.writeFileSync(outPath, raw);
    console.log(`Wrote ${outPath}`);
    if (downscaleMaxDim === undefined || downscaleMaxDim === null) return;
    const derived = deriveDownscalePath(outPath, downscaleSuffix);
    if (fs.existsSync(derived) && !force) die(`Output already exists: ${derived} (use --force to overwrite)`);
    fs.mkdirSync(path.dirname(derived), { recursive: true });
    fs.writeFileSync(derived, await downscaleImageBytes(raw, { maxDim: downscaleMaxDim, outputFormat }));
    console.log(`Wrote ${derived}`);
  }));
}

function deriveDownscalePath(filePath, suffix) {
  let value = suffix;
  if (value && !value.startsWith("-") && !value.startsWith("_")) value = `-${value}`;
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${value}${parsed.ext}`);
}

async function downscaleImageBytes(imageBytes, { maxDim, outputFormat }) {
  const { default: sharp } = await import("sharp").catch((error) => {
    const missingModule = error && error.code === "ERR_MODULE_NOT_FOUND";
    if (missingModule) die("Downscaling requires sharp. Run `npm install` in this repo first.");
    throw error;
  });
  if (maxDim < 1) die("--downscale-max-dim must be >= 1");
  const metadata = await sharp(imageBytes).metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const scale = Math.min(1.0, maxDim / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  let image = sharp(imageBytes);
  if (targetWidth !== width || targetHeight !== height) {
    image = image.resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 });
  }
  const fmt = outputFormat === "jpg" ? "jpeg" : outputFormat;
  if (fmt === "jpeg") return image.flatten({ background: "#ffffff" }).jpeg().toBuffer();
  if (fmt === "webp") return image.webp().toBuffer();
  return image.png().toBuffer();
}

function slugify(value) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  return slug ? slug.slice(0, 60) : "job";
}

function normalizeJob(job, idx) {
  if (typeof job === "string") {
    const prompt = job.trim();
    if (!prompt) die(`Empty prompt at job ${idx}`);
    return { prompt };
  }
  if (job && typeof job === "object" && !Array.isArray(job)) {
    if (!("prompt" in job) || !String(job.prompt).trim()) die(`Missing prompt for job ${idx}`);
    return job;
  }
  die(`Invalid job at index ${idx}: expected string or object.`);
}

function readJobsJsonl(filePath) {
  if (!fs.existsSync(filePath)) die(`Input file not found: ${filePath}`);
  const jobs = [];
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    try {
      const item = line.startsWith("{") ? JSON.parse(line) : line;
      jobs.push(normalizeJob(item, index + 1));
    } catch (error) {
      die(`Invalid JSON on line ${index + 1}: ${error.message}`);
    }
  });
  if (jobs.length === 0) die("No jobs found in input file.");
  if (jobs.length > MAX_BATCH_JOBS) die(`Too many jobs (${jobs.length}). Max is ${MAX_BATCH_JOBS}.`);
  return jobs;
}

function mergeNonNull(dst, src = {}) {
  const merged = { ...dst };
  for (const [key, value] of Object.entries(src)) {
    if (value !== null && value !== undefined) merged[key] = value;
  }
  return merged;
}

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null && value !== undefined));
}

function jobOutputPaths({ outDir, outputFormat, idx, prompt, n, explicitOut }) {
  fs.mkdirSync(outDir, { recursive: true });
  const ext = `.${outputFormat}`;
  let base;
  if (explicitOut) {
    const parsed = path.parse(explicitOut);
    if (!parsed.ext) {
      base = `${explicitOut}${ext}`;
    } else {
      if (parsed.ext.slice(1).toLowerCase() !== outputFormat) {
        warn(`Job ${idx}: output extension ${parsed.ext} does not match output-format ${outputFormat}.`);
      }
      base = explicitOut;
    }
    base = path.join(outDir, path.basename(base));
  } else {
    base = path.join(outDir, `${String(idx).padStart(3, "0")}-${slugify(prompt.slice(0, 80))}${ext}`);
  }
  if (n === 1) return [base];
  const parsed = path.parse(base);
  return Array.from({ length: n }, (_, i) => path.join(parsed.dir, `${parsed.name}-${i + 1}${parsed.ext}`));
}

function extractRetryAfterSeconds(error) {
  if (typeof error.retryAfter === "number" && error.retryAfter >= 0) return error.retryAfter;
  const match = String(error.message || error).match(/retry[- ]after[:= ]+([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number.parseFloat(match[1]) : null;
}

function isRateLimitError(error) {
  const name = error.name?.toLowerCase() || "";
  const message = String(error.message || error).toLowerCase();
  return name.includes("ratelimit") || name.includes("rate_limit") || message.includes("429") || message.includes("rate limit") || message.includes("too many requests");
}

function isTransientError(error) {
  if (isRateLimitError(error)) return true;
  const name = error.name?.toLowerCase() || "";
  const message = String(error.message || error).toLowerCase();
  return name.includes("timeout") || name.includes("timedout") || name.includes("tempor")
    || message.includes("timeout") || message.includes("timed out") || message.includes("connection reset");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function azureEndpoint(route, model) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, "");
  return `${endpoint}/openai/deployments/${encodeURIComponent(model)}/${route}?api-version=${encodeURIComponent(azureApiVersion())}`;
}

async function azureFetch(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "api-key": process.env.AZURE_OPENAI_API_KEY,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`${response.status} ${response.statusText}: ${text}`);
    error.status = response.status;
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) error.retryAfter = Number.parseFloat(retryAfter);
    throw error;
  }
  return response.json();
}

async function callGenerate(payload) {
  return azureFetch(azureEndpoint("images/generations", payload.model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function callEdit(payload, imagePaths, maskPath) {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (key !== "model" && value !== undefined && value !== null) form.append(key, String(value));
  }
  for (const imagePath of imagePaths) {
    form.append("image", new Blob([fs.readFileSync(imagePath)]), path.basename(imagePath));
  }
  if (maskPath) form.append("mask", new Blob([fs.readFileSync(maskPath)]), path.basename(maskPath));
  return azureFetch(azureEndpoint("images/edits", payload.model), { method: "POST", body: form });
}

async function generateOneWithRetries(payload, { attempts, jobLabel }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await callGenerate(payload);
    } catch (error) {
      lastError = error;
      if (!isTransientError(error)) throw error;
      if (attempt === attempts) throw error;
      const retryAfter = extractRetryAfterSeconds(error);
      const sleepSeconds = retryAfter ?? Math.min(60.0, 2.0 ** attempt);
      console.error(`${jobLabel} attempt ${attempt}/${attempts} failed (${error.name || "Error"}); retrying in ${sleepSeconds.toFixed(1)}s`);
      await sleep(sleepSeconds * 1000);
    }
  }
  throw lastError || new Error("unknown error");
}

async function generate(args) {
  const prompt = augmentPrompt(args, readPrompt(args.prompt, args.promptFile));
  const payload = compact({
    model: args.model,
    prompt,
    n: args.n,
    size: args.size,
    quality: args.quality,
    background: args.background,
    output_format: args.outputFormat,
    output_compression: args.outputCompression,
    moderation: args.moderation,
  });
  const outputFormat = normalizeOutputFormat(args.outputFormat);
  validateTransparency(args.background, outputFormat);
  payload.output_format = outputFormat;
  const outputPaths = buildOutputPaths(args.out, outputFormat, args.n, args.outDir);
  const downscaled = args.downscaleMaxDim === undefined ? null : outputPaths.map((p) => deriveDownscalePath(p, args.downscaleSuffix));
  if (args.dryRun) {
    printRequest({
      endpoint: "/openai/deployments/{model}/images/generations",
      api_version: azureApiVersion(),
      outputs: outputPaths,
      outputs_downscaled: downscaled,
      ...payload,
    });
    return;
  }
  console.error("Calling Azure OpenAI Image API (generation). This can take up to a couple of minutes.");
  const started = Date.now();
  const result = await callGenerate(payload);
  console.error(`Generation completed in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  await decodeWriteAndDownscale(result.data.map((item) => item.b64_json), outputPaths, {
    force: args.force,
    downscaleMaxDim: args.downscaleMaxDim,
    downscaleSuffix: args.downscaleSuffix,
    outputFormat,
  });
}

async function runGenerateBatch(args) {
  const jobs = readJobsJsonl(args.input);
  const baseFields = fieldsFromArgs(args);
  const basePayload = {
    model: args.model,
    n: args.n,
    size: args.size,
    quality: args.quality,
    background: args.background,
    output_format: args.outputFormat,
    output_compression: args.outputCompression,
    moderation: args.moderation,
  };
  if (args.dryRun) {
    jobs.forEach((job, index) => {
      const i = index + 1;
      const prompt = String(job.prompt).trim();
      let fields = mergeNonNull(baseFields, job.fields || {});
      fields = mergeNonNull(fields, Object.fromEntries(Object.keys(baseFields).map((key) => [key, job[key]])));
      const jobPayload = compact(mergeNonNull({ ...basePayload, prompt: augmentPromptFields(args.augment, prompt, fields) }, Object.fromEntries(Object.keys(basePayload).map((key) => [key, job[key]]))));
      validateGeneratePayload(jobPayload);
      const effectiveOutputFormat = normalizeOutputFormat(jobPayload.output_format);
      validateTransparency(jobPayload.background, effectiveOutputFormat);
      jobPayload.output_format = effectiveOutputFormat;
      const outputs = jobOutputPaths({
        outDir: args.outDir,
        outputFormat: effectiveOutputFormat,
        idx: i,
        prompt,
        n: parseInteger(jobPayload.n ?? 1, "n"),
        explicitOut: job.out,
      });
      const downscaled = args.downscaleMaxDim === undefined ? null : outputs.map((p) => deriveDownscalePath(p, args.downscaleSuffix));
      printRequest({
        endpoint: "/openai/deployments/{model}/images/generations",
        api_version: azureApiVersion(),
        job: i,
        outputs,
        outputs_downscaled: downscaled,
        ...jobPayload,
      });
    });
    return 0;
  }

  let cursor = 0;
  let anyFailed = false;
  let stop = false;
  async function worker() {
    while (!stop && cursor < jobs.length) {
      const index = cursor++;
      const i = index + 1;
      const job = jobs[index];
      const prompt = String(job.prompt).trim();
      const jobLabel = `[job ${i}/${jobs.length}]`;
      let fields = mergeNonNull(baseFields, job.fields || {});
      fields = mergeNonNull(fields, Object.fromEntries(Object.keys(baseFields).map((key) => [key, job[key]])));
      const payload = compact(mergeNonNull({ ...basePayload, prompt: augmentPromptFields(args.augment, prompt, fields) }, Object.fromEntries(Object.keys(basePayload).map((key) => [key, job[key]]))));
      const n = parseInteger(payload.n ?? 1, "n");
      validateGeneratePayload(payload);
      const effectiveOutputFormat = normalizeOutputFormat(payload.output_format);
      validateTransparency(payload.background, effectiveOutputFormat);
      payload.output_format = effectiveOutputFormat;
      const outputs = jobOutputPaths({
        outDir: args.outDir,
        outputFormat: effectiveOutputFormat,
        idx: i,
        prompt,
        n,
        explicitOut: job.out,
      });
      try {
        console.error(`${jobLabel} starting`);
        const started = Date.now();
        const result = await generateOneWithRetries(payload, { attempts: args.maxAttempts, jobLabel });
        console.error(`${jobLabel} completed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        await decodeWriteAndDownscale(result.data.map((item) => item.b64_json), outputs, {
          force: args.force,
          downscaleMaxDim: args.downscaleMaxDim,
          downscaleSuffix: args.downscaleSuffix,
          outputFormat: effectiveOutputFormat,
        });
      } catch (error) {
        anyFailed = true;
        console.error(`${jobLabel} failed: ${error.message || error}`);
        if (args.failFast) {
          stop = true;
          throw error;
        }
      }
    }
  }
  const workers = Array.from({ length: Math.min(args.concurrency, jobs.length) }, () => worker());
  await Promise.all(workers);
  return anyFailed ? 1 : 0;
}

async function generateBatch(args) {
  const exitCode = await runGenerateBatch(args);
  if (exitCode) process.exit(exitCode);
}

async function edit(args) {
  const prompt = augmentPrompt(args, readPrompt(args.prompt, args.promptFile));
  const imagePaths = checkImagePaths(args.image);
  let maskPath = args.mask;
  if (maskPath) {
    if (!fs.existsSync(maskPath)) die(`Mask file not found: ${maskPath}`);
    if (path.extname(maskPath).toLowerCase() !== ".png") warn(`Mask should be a PNG with an alpha channel: ${maskPath}`);
    if (fs.statSync(maskPath).size > MAX_IMAGE_BYTES) warn(`Mask exceeds 50MB limit: ${maskPath}`);
  } else {
    maskPath = null;
  }
  const payload = compact({
    model: args.model,
    prompt,
    n: args.n,
    size: args.size,
    quality: args.quality,
    background: args.background,
    output_format: args.outputFormat,
    output_compression: args.outputCompression,
    input_fidelity: args.inputFidelity,
    moderation: args.moderation,
  });
  const outputFormat = normalizeOutputFormat(args.outputFormat);
  validateTransparency(args.background, outputFormat);
  payload.output_format = outputFormat;
  validateInputFidelity(args.inputFidelity);
  const outputPaths = buildOutputPaths(args.out, outputFormat, args.n, args.outDir);
  const downscaled = args.downscaleMaxDim === undefined ? null : outputPaths.map((p) => deriveDownscalePath(p, args.downscaleSuffix));
  if (args.dryRun) {
    const payloadPreview = { ...payload, image: imagePaths.map(String) };
    if (maskPath) payloadPreview.mask = String(maskPath);
    printRequest({
      endpoint: "/openai/deployments/{model}/images/edits",
      api_version: azureApiVersion(),
      outputs: outputPaths,
      outputs_downscaled: downscaled,
      ...payloadPreview,
    });
    return;
  }
  console.error("Calling Azure OpenAI Image API (edit). This can take up to a couple of minutes.");
  const started = Date.now();
  const result = await callEdit(payload, imagePaths, maskPath);
  console.error(`Edit completed in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  await decodeWriteAndDownscale(result.data.map((item) => item.b64_json), outputPaths, {
    force: args.force,
    downscaleMaxDim: args.downscaleMaxDim,
    downscaleSuffix: args.downscaleSuffix,
    outputFormat,
  });
}

function applySharedArg(args, token, value) {
  switch (token) {
    case "--model":
      args.model = value();
      return true;
    case "--prompt":
      args.prompt = value();
      return true;
    case "--prompt-file":
      args.promptFile = value();
      return true;
    case "--n":
      args.n = parseInteger(value(), "--n");
      return true;
    case "--size":
      args.size = value();
      return true;
    case "--quality":
      args.quality = value();
      return true;
    case "--background":
      args.background = value();
      return true;
    case "--output-format":
      args.outputFormat = value();
      return true;
    case "--output-compression":
      args.outputCompression = parseInteger(value(), "--output-compression");
      return true;
    case "--moderation":
      args.moderation = value();
      return true;
    case "--out":
      args.out = value();
      return true;
    case "--out-dir":
      args.outDir = value();
      return true;
    case "--force":
      args.force = true;
      return true;
    case "--dry-run":
      args.dryRun = true;
      return true;
    case "--augment":
      args.augment = true;
      return true;
    case "--no-augment":
      args.augment = false;
      return true;
    case "--use-case":
      args.useCase = value();
      return true;
    case "--scene":
      args.scene = value();
      return true;
    case "--subject":
      args.subject = value();
      return true;
    case "--style":
      args.style = value();
      return true;
    case "--composition":
      args.composition = value();
      return true;
    case "--lighting":
      args.lighting = value();
      return true;
    case "--palette":
      args.palette = value();
      return true;
    case "--materials":
      args.materials = value();
      return true;
    case "--text":
      args.text = value();
      return true;
    case "--constraints":
      args.constraints = value();
      return true;
    case "--negative":
      args.negative = value();
      return true;
    case "--downscale-max-dim":
      args.downscaleMaxDim = parseInteger(value(), "--downscale-max-dim");
      return true;
    case "--downscale-suffix":
      args.downscaleSuffix = value();
      return true;
    default:
      return false;
  }
}

function parseArgs(argv) {
  if (argv.length === 0 || ["-h", "--help"].includes(argv[0])) {
    printHelp();
    process.exit(0);
  }
  const command = argv[0];
  if (!["generate", "generate-batch", "edit"].includes(command)) die(`invalid choice: ${command}`);
  const args = {
    command,
    model: defaultModel(),
    n: 1,
    size: DEFAULT_SIZE,
    quality: DEFAULT_QUALITY,
    out: DEFAULT_OUTPUT_PATH,
    force: false,
    dryRun: false,
    augment: true,
    downscaleSuffix: DEFAULT_DOWNSCALE_SUFFIX,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) die(`${token} requires a value`);
      return argv[++i];
    };
    if (["-h", "--help"].includes(token)) {
      printHelp(command);
      process.exit(0);
    }
    if (applySharedArg(args, token, next)) continue;
    if (command === "generate-batch") {
      if (token === "--input") args.input = next();
      else if (token === "--concurrency") args.concurrency = parseInteger(next(), "--concurrency");
      else if (token === "--max-attempts") args.maxAttempts = parseInteger(next(), "--max-attempts");
      else if (token === "--fail-fast") args.failFast = true;
      else die(`unrecognized argument: ${token}`);
    } else if (command === "edit") {
      if (token === "--image") {
        args.image = args.image || [];
        args.image.push(next());
      } else if (token === "--mask") args.mask = next();
      else if (token === "--input-fidelity") args.inputFidelity = next();
      else die(`unrecognized argument: ${token}`);
    } else {
      die(`unrecognized argument: ${token}`);
    }
  }
  if (command === "generate-batch") {
    args.concurrency ??= DEFAULT_CONCURRENCY;
    args.maxAttempts ??= 3;
    args.failFast ??= false;
    if (!args.input) die("generate-batch requires --input");
  }
  if (command === "edit" && (!args.image || args.image.length === 0)) die("edit requires --image");
  return args;
}

function validateTopLevel(args) {
  if (!Number.isInteger(args.n) || args.n < 1 || args.n > 10) die("--n must be between 1 and 10");
  const concurrency = args.concurrency ?? 1;
  if (concurrency < 1 || concurrency > 25) die("--concurrency must be between 1 and 25");
  const maxAttempts = args.maxAttempts ?? 3;
  if (maxAttempts < 1 || maxAttempts > 10) die("--max-attempts must be between 1 and 10");
  if (args.outputCompression !== undefined && (args.outputCompression < 0 || args.outputCompression > 100)) {
    die("--output-compression must be between 0 and 100");
  }
  if (args.command === "generate-batch" && !args.outDir) die("generate-batch requires --out-dir");
  if (args.downscaleMaxDim !== undefined && args.downscaleMaxDim < 1) die("--downscale-max-dim must be >= 1");
  validateModel(args.model);
  validateSize(args.size, args.model);
  validateQuality(args.quality);
  validateBackground(args.background);
  validateModelSpecificOptions({
    model: args.model,
    background: args.background,
    inputFidelity: args.inputFidelity,
  });
  ensureApiKey(args.dryRun);
}

function printHelp(command = null) {
  const shared = `shared options:
  --model MODEL
  --prompt PROMPT
  --prompt-file PATH
  --n N
  --size SIZE
  --quality low|medium|high|auto
  --background transparent|opaque|auto
  --output-format png|jpeg|jpg|webp
  --output-compression N
  --moderation VALUE
  --out PATH
  --out-dir DIR
  --force
  --dry-run
  --augment | --no-augment
  --use-case VALUE --scene VALUE --subject VALUE --style VALUE
  --composition VALUE --lighting VALUE --palette VALUE --materials VALUE
  --text VALUE --constraints VALUE --negative VALUE
  --downscale-max-dim N
  --downscale-suffix SUFFIX`;
  if (command === "generate-batch") {
    console.log(`usage: image_gen.js generate-batch --input PATH --out-dir DIR [options]\n\n${shared}\n  --input PATH\n  --concurrency N\n  --max-attempts N\n  --fail-fast`);
  } else if (command === "edit") {
    console.log(`usage: image_gen.js edit --image PATH --prompt PROMPT [options]\n\n${shared}\n  --image PATH\n  --mask PATH\n  --input-fidelity low|high`);
  } else if (command === "generate") {
    console.log(`usage: image_gen.js generate --prompt PROMPT [options]\n\n${shared}`);
  } else {
    console.log(`usage: image_gen.js {generate,generate-batch,edit} [options]\n\nFallback CLI for explicit image generation or editing via Azure OpenAI GPT Image deployments`);
  }
}

const args = parseArgs(process.argv.slice(2));
validateTopLevel(args);
const command = args.command === "generate" ? generate : args.command === "generate-batch" ? generateBatch : edit;
command(args).catch((error) => die(error.message || String(error)));
