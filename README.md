# Image Generation Skill for Azure OpenAI

![imagegen-aoai banner](assets/imagegen-aoai.png)

這是一個 GitHub Copilot CLI skill，用來產生或編輯點陣圖影像資產，例如網站 hero image、產品圖、遊戲素材、UI mockup、插圖、資訊圖表與透明背景 cutout。

此版本的 CLI 使用 Azure OpenAI Image API，不再使用 OpenAI API。

## 功能特色

- 產生新影像：概念圖、產品圖、網站視覺、行銷素材、插圖等。
- 編輯既有影像：背景替換、局部修改、移除物件、合成、透明背景處理等。
- 支援批次產生：使用 JSONL 描述多個 image generation 工作。
- 支援 Azure OpenAI：透過 Azure OpenAI endpoint、API key 與 image deployment 呼叫模型。
- 支援 dry-run：不需網路、不需安裝 `openai` 套件即可檢查 API payload 與輸出路徑。
- 支援本機後處理：可選擇額外產生縮圖，透明背景可搭配 chroma-key removal helper。

## 專案結構

```text
.
├── SKILL.md
├── agents/
│   └── openai.yaml
├── assets/
│   ├── imagegen-aoai.png
│   ├── imagegen.png
│   └── imagegen-small.svg
├── references/
│   ├── cli.md
│   ├── codex-network.md
│   ├── image-api.md
│   ├── prompting.md
│   └── sample-prompts.md
├── package.json
└── scripts/
    ├── image_gen.js
    └── remove_chroma_key.js
```

## 使用模式

這個 skill 使用 `scripts/image_gen.js` 直接呼叫 Azure OpenAI Image API。GitHub Copilot CLI 沒有內建影像產生或影像檢視工具，因此此 skill 不會依賴不存在的內建工具。

## Azure OpenAI 設定

Fallback CLI 的 live API call 需要設定下列環境變數：

```bash
export IMAGEGEN_AZURE_OPENAI_ENDPOINT="https://<resource-name>.openai.azure.com"
export IMAGEGEN_AZURE_OPENAI_API_KEY="<key>"
export IMAGEGEN_AZURE_OPENAI_IMAGE_DEPLOYMENT="${IMAGEGEN_AZURE_OPENAI_IMAGE_DEPLOYMENT:-gpt-image-2}"
export IMAGEGEN_AZURE_OPENAI_API_VERSION="2025-04-01-preview"
```

說明：

- `IMAGEGEN_AZURE_OPENAI_ENDPOINT`：Azure OpenAI resource endpoint，格式為 `https://<resource-name>.openai.azure.com`，只填到 resource host，不要包含 `/openai/deployments/...`、模型名稱或 API version。範例：`https://my-image-resource.openai.azure.com`。
- `IMAGEGEN_AZURE_OPENAI_API_KEY`：Azure OpenAI API key。
- `IMAGEGEN_AZURE_OPENAI_IMAGE_DEPLOYMENT`：Azure OpenAI image deployment 名稱，預設為 `gpt-image-2`。
- `IMAGEGEN_AZURE_OPENAI_API_VERSION`：API version，預設為 `2025-04-01-preview`。
- 若未設定 `IMAGEGEN_AZURE_OPENAI_API_VERSION`，CLI 也會接受 `OPENAI_API_VERSION` 作為相容 fallback。

> 注意：在 Azure OpenAI 中，CLI 的 `--model` 參數代表 deployment name，不一定等於 base model name。

## 安裝相依套件

Fallback CLI 需要 Node.js 與 npm 套件。Azure OpenAI 呼叫使用 Node 內建 `fetch`，本機縮圖與透明背景後處理使用 `sharp`：

```bash
npm install
```

## CLI 快速開始

建議先設定 CLI 路徑：

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export IMAGE_GEN="$CODEX_HOME/skills/.system/imagegen/scripts/image_gen.js"
```

### Dry-run

Dry-run 不會呼叫 API，也不需要網路：

```bash
node "$IMAGE_GEN" generate \
  --prompt "Test" \
  --out output/imagegen/test.png \
  --dry-run
```

### 產生影像

```bash
node "$IMAGE_GEN" generate \
  --prompt "A cozy alpine cabin at dawn" \
  --size 1024x1024 \
  --out output/imagegen/alpine-cabin.png
```

### 編輯影像

```bash
node "$IMAGE_GEN" edit \
  --image input.png \
  --prompt "Replace only the background with a warm sunset" \
  --out output/imagegen/sunset-edit.png
```

### 批次產生影像

先建立 JSONL：

```bash
mkdir -p tmp/imagegen output/imagegen/batch
cat > tmp/imagegen/prompts.jsonl << 'EOF'
{"prompt":"Cavernous hangar interior with a compact shuttle parked near the center","use_case":"stylized-concept","composition":"wide-angle, low-angle","lighting":"volumetric light rays through drifting fog","constraints":"no logos or trademarks; no watermark","size":"1536x1024"}
{"prompt":"Gray wolf in profile in a snowy forest","use_case":"photorealistic-natural","composition":"eye-level","constraints":"no logos or trademarks; no watermark","size":"1024x1024"}
EOF
```

執行批次工作：

```bash
node "$IMAGE_GEN" generate-batch \
  --input tmp/imagegen/prompts.jsonl \
  --out-dir output/imagegen/batch \
  --concurrency 5
```

#### JSONL 格式

`generate-batch --input` 讀取 JSONL（JSON Lines）檔案：每一行是一個獨立的產圖工作。空行與 `#` 開頭的註解行會被忽略，最多可包含 500 個工作。

每行可以使用下列兩種格式之一：

```jsonl
{"prompt":"Gray wolf in profile in a snowy forest"}
Gray wolf in profile in a snowy forest
```

物件格式必須包含 `prompt`，且 `prompt` 不能是空字串。純文字行會自動視為該工作的 `prompt`。

JSONL 中的屬性會覆蓋 CLI 參數或預設值；未指定的屬性會沿用 CLI 參數或預設值。例如可在 CLI 指定共用的 `--quality medium`，再於特定 JSONL 行用 `"quality":"high"` 覆蓋。

| JSONL 屬性 | 必填 | 說明 |
| --- | --- | --- |
| `prompt` | 是 | 此工作使用的文字提示詞。純文字行等同於只設定 `prompt`。 |
| `model` | 否 | Azure OpenAI image deployment name。未指定時使用 `--model` 或 `IMAGEGEN_AZURE_OPENAI_IMAGE_DEPLOYMENT`。 |
| `size` | 否 | 輸出尺寸。可用 `auto` 或 `WIDTHxHEIGHT`，例如 `1024x1024`、`1536x1024`。 |
| `quality` | 否 | `low`、`medium`、`high` 或 `auto`。 |
| `background` | 否 | `transparent`、`opaque` 或 `auto`。注意預設 `gpt-image-2` 不支援 `transparent`。 |
| `output_format` | 否 | `png`、`jpeg`、`jpg` 或 `webp`；`jpg` 會正規化為 `jpeg`。 |
| `output_compression` | 否 | 輸出壓縮率，整數 `0` 到 `100`。 |
| `moderation` | 否 | 傳給 Image API 的 moderation 值。 |
| `n` | 否 | 同一個 prompt 產生的變體數，整數 `1` 到 `10`。多個不同資產應使用多行 job，而不是只增加 `n`。 |
| `out` | 否 | 此工作的輸出檔名。批次模式會把它視為 `--out-dir` 底下的檔名，目錄部分會被忽略。未指定時會依序號與 prompt 自動產生檔名。 |
| `use_case` | 否 | Prompt augmentation 欄位；描述用途或情境。 |
| `scene` | 否 | Prompt augmentation 欄位；描述場景或背景。 |
| `subject` | 否 | Prompt augmentation 欄位；描述主體。 |
| `style` | 否 | Prompt augmentation 欄位；描述風格或媒材。 |
| `composition` | 否 | Prompt augmentation 欄位；描述構圖、鏡位或 framing。 |
| `lighting` | 否 | Prompt augmentation 欄位；描述光線或氛圍。 |
| `palette` | 否 | Prompt augmentation 欄位；描述色彩配置。 |
| `materials` | 否 | Prompt augmentation 欄位；描述材質或紋理。 |
| `text` | 否 | Prompt augmentation 欄位；指定影像中要出現的文字。 |
| `constraints` | 否 | Prompt augmentation 欄位；描述必須遵守的限制。 |
| `negative` | 否 | Prompt augmentation 欄位；描述要避免的內容。 |
| `fields` | 否 | 另一種提供 prompt augmentation 欄位的方式，例如 `"fields":{"style":"studio photo","constraints":"no watermark"}`。同一層的 augmentation 欄位會覆蓋 `fields` 內的同名欄位。 |

完整範例：

```jsonl
{"prompt":"Cavernous hangar interior with a compact shuttle parked near the center","use_case":"stylized-concept","composition":"wide-angle, low-angle","lighting":"volumetric light rays through drifting fog","constraints":"no logos or trademarks; no watermark","size":"1536x1024","quality":"high","out":"hangar.png"}
{"prompt":"Gray wolf in profile in a snowy forest","fields":{"use_case":"photorealistic-natural","composition":"eye-level","constraints":"no logos or trademarks; no watermark"},"size":"1024x1024","output_format":"png"}
{"prompt":"Three visual variants of a cozy alpine cabin at dawn","n":3,"out":"alpine-cabin.png"}
```

若使用 `gpt-image-2` 並指定明確尺寸，尺寸還必須符合模型限制：寬高都要是 16 的倍數、長邊不超過 3840px、長短邊比例不超過 3:1，總像素數需介於 655,360 到 8,294,400 之間。

## 預設值

| 設定 | 預設值 |
| --- | --- |
| Model / deployment | `IMAGEGEN_AZURE_OPENAI_IMAGE_DEPLOYMENT`，未設定時為 `gpt-image-2` |
| Size | `auto` |
| Quality | `medium` |
| Output format | `png` |
| Output path | `output/imagegen/output.png` |
| API version | `IMAGEGEN_AZURE_OPENAI_API_VERSION`，未設定時為 `2025-04-01-preview` |

## 常用參數

| 參數 | 說明 |
| --- | --- |
| `--prompt` | 文字提示詞 |
| `--prompt-file` | 從檔案讀取提示詞 |
| `--model` | Azure OpenAI image deployment name |
| `--size` | 輸出尺寸，例如 `1024x1024`、`1536x1024`、`auto` |
| `--quality` | `low`、`medium`、`high` 或 `auto` |
| `--output-format` | `png`、`jpeg`、`webp` |
| `--out` | 單次輸出路徑 |
| `--out-dir` | 多張輸出目錄 |
| `--dry-run` | 只輸出 payload，不呼叫 API |
| `--force` | 覆寫既有輸出檔案 |
| `--downscale-max-dim` | 額外產生長邊限制的縮圖 |

## 透明背景策略

一般透明背景需求優先使用 `gpt-image-2` 產生單色 chroma-key 背景，再使用本機 helper 移除背景。

只有在使用者明確要求 true native transparency，或影像內容不適合 chroma-key removal，例如毛髮、煙霧、玻璃、液體、透明材質或反光物件時，才應確認後改用 `gpt-image-1.5` true-transparency 路徑。

`gpt-image-2` 不支援 `background=transparent`。若需要 true native transparency，請使用 Azure OpenAI 的 `gpt-image-1.5` deployment，並搭配：

```bash
node "$IMAGE_GEN" generate \
  --model "<gpt-image-1.5-deployment-name>" \
  --prompt "A clean product cutout on a transparent background" \
  --background transparent \
  --output-format png \
  --out output/imagegen/product-cutout.png
```

## 輸出慣例

- 專案內的最終輸出建議放在 `output/imagegen/`。
- 暫存 JSONL 或中間檔建議放在 `tmp/imagegen/`。
- 預設不覆寫既有檔案；若確定要覆寫，請加上 `--force`。
- 若產生的圖會被專案引用，請不要只保留在 `$CODEX_HOME/generated_images/`。

## 參考文件

- `SKILL.md`：skill 的主要規則與工作流程。
- `references/cli.md`：CLI 使用細節。
- `references/image-api.md`：Azure OpenAI Image API 參數與 endpoint 說明。
- `references/prompting.md`：提示詞設計建議。
- `references/sample-prompts.md`：常見使用情境提示詞範本。
- `references/codex-network.md`：網路與 sandbox 相關說明。

## 授權

請參考 `LICENSE.txt`。
