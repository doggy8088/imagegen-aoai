# Image API quick reference

This file documents the CLI/API/model controls used by `scripts/image_gen.js`, including the `gpt-image-1.5` true-transparency path.

These parameters describe the Image API and bundled CLI surface.

## Scope
- This CLI is intended for GPT Image models (`gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini`).
- GitHub Copilot CLI does not provide built-in image-generation or image-viewing tools; use the bundled CLI for image generation and editing.

## Model summary

| Model | Quality | Input fidelity | Resolutions | Recommended use |
| --- | --- | --- | --- | --- |
| `gpt-image-2` | `low`, `medium`, `high`, `auto` | Always high fidelity for image inputs; do not set `input_fidelity` | `auto` or flexible sizes that satisfy the constraints below | Default for new CLI/API workflows: high-quality generation and editing, text-heavy images, photorealism, compositing, identity-sensitive edits, and workflows where fewer retries matter |
| `gpt-image-1.5` | `low`, `medium`, `high`, `auto` | `low`, `high` | `1024x1024`, `1024x1536`, `1536x1024`, `auto` | True transparent-background fallback and backward-compatible workflows |
| `gpt-image-1` | `low`, `medium`, `high`, `auto` | `low`, `high` | `1024x1024`, `1024x1536`, `1536x1024`, `auto` | Legacy compatibility |
| `gpt-image-1-mini` | `low`, `medium`, `high`, `auto` | `low`, `high` | `1024x1024`, `1024x1536`, `1536x1024`, `auto` | Cost-sensitive draft batches and lower-stakes previews |

## gpt-image-2 sizes

`gpt-image-2` accepts `auto` or any `WIDTHxHEIGHT` size that satisfies all constraints:

- Maximum edge length must be less than or equal to `3840px`.
- Both edges must be multiples of `16px`.
- Long edge to short edge ratio must not exceed `3:1`.
- Total pixels must be at least `655,360` and no more than `8,294,400`.

Popular sizes:

| Label | Size | Notes |
| --- | --- | --- |
| Square | `1024x1024` | Typical fast default |
| Landscape | `1536x1024` | Standard landscape |
| Portrait | `1024x1536` | Standard portrait |
| 2K square | `2048x2048` | Larger square output |
| 2K landscape | `2048x1152` | Widescreen output |
| 4K landscape | `3840x2160` | Widescreen 4K output |
| 4K portrait | `2160x3840` | Vertical 4K output |
| Auto | `auto` | Default size |

Square images are typically fastest to generate. For 4K-style output, use `3840x2160` or `2160x3840`.

## Azure OpenAI setup
- Client: `AzureOpenAI(...)` / `AsyncAzureOpenAI(...)` from the `openai` Python package.
- Required environment: `IMAGEGEN_AZURE_OPENAI_ENDPOINT` and `IMAGEGEN_AZURE_OPENAI_API_KEY`.
- Optional environment: `IMAGEGEN_AZURE_OPENAI_API_VERSION` (defaults to `2025-04-01-preview`) and `IMAGEGEN_AZURE_OPENAI_IMAGE_DEPLOYMENT` (defaults to `gpt-image-2`).
- In Azure OpenAI, the `model` parameter is the image deployment name. It can be supplied with `--model` or defaulted from `IMAGEGEN_AZURE_OPENAI_IMAGE_DEPLOYMENT`, falling back to `gpt-image-2`.

## Endpoints
- Generate: `POST /openai/deployments/{deployment}/images/generations?api-version=...` (`client.images.generate(...)`)
- Edit: `POST /openai/deployments/{deployment}/images/edits?api-version=...` (`client.images.edit(...)`)

## Core parameters for GPT Image models
- `prompt`: text prompt
- `model`: Azure OpenAI image deployment name
- `n`: number of images (1-10)
- `size`: `auto` by default for `gpt-image-2`; flexible `WIDTHxHEIGHT` sizes are allowed only for `gpt-image-2`; older GPT Image models use `1024x1024`, `1536x1024`, `1024x1536`, or `auto`
- `quality`: `low`, `medium`, `high`, or `auto`
- `background`: output transparency behavior (`transparent`, `opaque`, or `auto`) for generated output; this is not the same thing as the prompt's visual scene/backdrop
- `output_format`: `png` (default), `jpeg`, `webp`
- `output_compression`: 0-100 (jpeg/webp only)
- `moderation`: `auto` (default) or `low`

## Edit-specific parameters
- `image`: one or more input images. For GPT Image models, you can provide up to 16 images.
- `mask`: optional mask image
- `input_fidelity`: `low` or `high` only for models that support it; do not set this for `gpt-image-2`

Model-specific note for `input_fidelity`:
- `gpt-image-2` always uses high fidelity for image inputs and does not support setting `input_fidelity`.
- `gpt-image-1` and `gpt-image-1-mini` preserve all input images, but the first image gets richer textures and finer details.
- `gpt-image-1.5` preserves the first 5 input images with higher fidelity.

## Transparent backgrounds

`gpt-image-2` does not currently support the Image API `background=transparent` parameter. The skill's default transparent-image path is `gpt-image-2` with a flat chroma-key background, followed by local alpha extraction with `node "${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/scripts/remove_chroma_key.js"`.

Use CLI `gpt-image-1.5` with `background=transparent` and a transparent-capable output format such as `png` or `webp` only after the user explicitly confirms that path, unless they already requested `gpt-image-1.5` or `scripts/image_gen.js`. If the user asks for true/native transparency, the subject is too complex for clean chroma-key removal, or local background removal fails validation, explain the tradeoff and ask before switching.

## Output
- `data[]` list with `b64_json` per image
- The bundled `scripts/image_gen.js` CLI decodes `b64_json` and writes output files for you.

## Limits and notes
- Input images and masks must be under 50MB.
- Use the edits endpoint when the user requests changes to an existing image.
- Masking is prompt-guided; exact shapes are not guaranteed.
- Large sizes and high quality increase latency and cost.
- Use `quality=low` for fast drafts, thumbnails, and quick iterations. Use `medium` or `high` for final assets, dense text, diagrams, identity-sensitive edits, or high-resolution outputs.
- High `input_fidelity` can materially increase input token usage on models that support it.
- If a request fails because a specific option is unsupported by the selected Azure OpenAI image deployment, retry manually without that option only when the option is not required by the user. If true transparent CLI output is required, ask before switching to a `gpt-image-1.5` deployment instead of dropping `background=transparent`, unless the user already explicitly chose that fallback.

## Important boundary
- `quality`, `input_fidelity`, explicit masks, `background`, `output_format`, and related parameters are CLI execution controls.
