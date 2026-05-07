# Image Generation Skill for Azure OpenAI

這是一個 GitHub Copilot CLI skill，用來產生或編輯點陣圖影像資產，例如網站 hero image、產品圖、遊戲素材、UI mockup、插圖、資訊圖表與透明背景 cutout。

此版本的 fallback CLI 已改為使用 Azure OpenAI Image API，不再使用 OpenAI API。

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
│   ├── imagegen.png
│   └── imagegen-small.svg
├── references/
│   ├── cli.md
│   ├── codex-network.md
│   ├── image-api.md
│   ├── prompting.md
│   └── sample-prompts.md
└── scripts/
    ├── image_gen.py
    └── remove_chroma_key.py
```

## 使用模式

這個 skill 有兩種主要模式：

1. **內建工具模式**：預設使用 Copilot CLI 的內建 `image_gen` 工具，適合一般產圖、修圖與簡單透明背景需求，不需要 Azure OpenAI credentials。
2. **Fallback CLI 模式**：使用 `scripts/image_gen.py` 直接呼叫 Azure OpenAI Image API。只有在明確需要 CLI/API/model 控制，或經確認需要 true native transparency fallback 時使用。

## Azure OpenAI 設定

Fallback CLI 的 live API call 需要設定下列環境變數：

```bash
export AZURE_OPENAI_ENDPOINT="https://<resource-name>.openai.azure.com"
export AZURE_OPENAI_API_KEY="<key>"
export AZURE_OPENAI_IMAGE_DEPLOYMENT="${AZURE_OPENAI_IMAGE_DEPLOYMENT:-gpt-image-2}"
export AZURE_OPENAI_API_VERSION="2025-04-01-preview"
```

說明：

- `AZURE_OPENAI_ENDPOINT`：Azure OpenAI resource endpoint。
- `AZURE_OPENAI_API_KEY`：Azure OpenAI API key。
- `AZURE_OPENAI_IMAGE_DEPLOYMENT`：Azure OpenAI image deployment 名稱，預設為 `gpt-image-2`。
- `AZURE_OPENAI_API_VERSION`：API version，預設為 `2025-04-01-preview`。
- 若未設定 `AZURE_OPENAI_API_VERSION`，CLI 也會接受 `OPENAI_API_VERSION` 作為相容 fallback。

> 注意：在 Azure OpenAI 中，CLI 的 `--model` 參數代表 deployment name，不一定等於 base model name。

## 安裝相依套件

Fallback CLI 需要 OpenAI Python SDK，Azure OpenAI client 也由此套件提供：

```bash
uv pip install openai
```

如果需要本機縮圖或透明背景後處理，也需要 Pillow：

```bash
uv pip install pillow
```

## CLI 快速開始

建議先設定 CLI 路徑：

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export IMAGE_GEN="$CODEX_HOME/skills/.system/imagegen/scripts/image_gen.py"
```

### Dry-run

Dry-run 不會呼叫 API，也不需要網路：

```bash
python "$IMAGE_GEN" generate \
  --prompt "Test" \
  --out output/imagegen/test.png \
  --dry-run
```

### 產生影像

```bash
python "$IMAGE_GEN" generate \
  --prompt "A cozy alpine cabin at dawn" \
  --size 1024x1024 \
  --out output/imagegen/alpine-cabin.png
```

### 編輯影像

```bash
python "$IMAGE_GEN" edit \
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
python "$IMAGE_GEN" generate-batch \
  --input tmp/imagegen/prompts.jsonl \
  --out-dir output/imagegen/batch \
  --concurrency 5
```

## 預設值

| 設定 | 預設值 |
| --- | --- |
| Model / deployment | `AZURE_OPENAI_IMAGE_DEPLOYMENT`，未設定時為 `gpt-image-2` |
| Size | `auto` |
| Quality | `medium` |
| Output format | `png` |
| Output path | `output/imagegen/output.png` |
| API version | `AZURE_OPENAI_API_VERSION`，未設定時為 `2025-04-01-preview` |

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

一般透明背景需求優先使用內建 `image_gen` 工具產生單色 chroma-key 背景，再使用本機 helper 移除背景。

只有在使用者明確要求 true native transparency，或影像內容不適合 chroma-key removal，例如毛髮、煙霧、玻璃、液體、透明材質或反光物件時，才應確認後改用 CLI fallback。

`gpt-image-2` 不支援 `background=transparent`。若需要 true native transparency，請使用 Azure OpenAI 的 `gpt-image-1.5` deployment，並搭配：

```bash
python "$IMAGE_GEN" generate \
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
- `references/cli.md`：fallback CLI 使用細節。
- `references/image-api.md`：Azure OpenAI Image API 參數與 endpoint 說明。
- `references/prompting.md`：提示詞設計建議。
- `references/sample-prompts.md`：常見使用情境提示詞範本。
- `references/codex-network.md`：網路與 sandbox 相關說明。

## 授權

請參考 `LICENSE.txt`。
