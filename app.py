import os
from dotenv import load_dotenv
load_dotenv()
import io
import base64
import torch
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
from transformers import AutoProcessor, AutoModelForCausalLM, PreTrainedModel
from huggingface_hub import InferenceClient

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

# Florence-2 setup

# ──────────────────────────────────────────────
# Load Florence-2 once at startup
# ──────────────────────────────────────────────
FLORENCE_MODEL_ID = "microsoft/Florence-2-base"
print(f"[startup] Loading {FLORENCE_MODEL_ID} …")

device = "cuda" if torch.cuda.is_available() else "cpu"
dtype  = torch.float16 if device == "cuda" else torch.float32

florence_processor = AutoProcessor.from_pretrained(
    FLORENCE_MODEL_ID, trust_remote_code=True
)
florence_model = AutoModelForCausalLM.from_pretrained(
    FLORENCE_MODEL_ID, trust_remote_code=True, attn_implementation="eager"
).to(device)

print("[startup] Florence-2 ready ✓")

# ──────────────────────────────────────────────
# HF Inference client for Zephyr-7b
# ──────────────────────────────────────────────
HF_TOKEN = os.environ.get("HF_TOKEN", "")   # set via env or .env
print(f"[startup] HF_TOKEN length: {len(HF_TOKEN)} (starts with: {HF_TOKEN[:5]}...)")
ZEPHYR_MODEL = "HuggingFaceH4/zephyr-7b-beta"
hf_client = InferenceClient(model=ZEPHYR_MODEL, token=HF_TOKEN if HF_TOKEN else None)

# ──────────────────────────────────────────────
# Prompts per platform / tone
# ──────────────────────────────────────────────
PLATFORM_HINTS = {
    "instagram": "Write a short, engaging Instagram caption (under 150 characters) with 3-5 relevant emojis and 3-5 trending hashtags.",
    "twitter":   "Write a punchy tweet (under 280 characters) with 1-2 emojis. No hashtags needed unless they add real value.",
    "linkedin":  "Write a professional LinkedIn post (2-3 sentences) that is insightful and ends with a thought-provoking question or call-to-action. No emojis.",
    "facebook":  "Write a warm, conversational Facebook post (2-4 sentences) with 1-2 emojis that invites engagement.",
    "tiktok":    "Write a short, catchy TikTok caption (max 100 characters) with 2-4 trendy emojis and 3-4 viral hashtags.",
}

TONE_HINTS = {
    "casual":       "Keep the tone casual, friendly, and relatable.",
    "funny":        "Make it funny, witty, and humorous with a playful vibe.",
    "professional": "Maintain a polished, professional, and authoritative tone.",
    "sarcastic":    "Add a layer of dry sarcasm and irony — clever but not mean.",
    "inspirational":"Make it uplifting, motivational, and inspiring.",
    "aesthetic":    "Give it an aesthetic, poetic, and dreamy feel.",
}


def describe_image(pil_image: Image.Image) -> str:
    """Run Florence-2 detailed caption on the image."""
    task_prompt = "<MORE_DETAILED_CAPTION>"
    inputs = florence_processor(
        text=task_prompt, images=pil_image, return_tensors="pt"
    ).to(device, dtype)

    with torch.no_grad():
        generated_ids = florence_model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=256,
            num_beams=3,
        )

    generated_text = florence_processor.batch_decode(
        generated_ids, skip_special_tokens=False
    )[0]
    parsed = florence_processor.post_process_generation(
        generated_text,
        task=task_prompt,
        image_size=(pil_image.width, pil_image.height),
    )
    return parsed.get(task_prompt, generated_text)


def generate_captions(description: str, platform: str, tone: str,
                      extra_context: str = "") -> list[str]:
    """Use Zephyr-7b to create 3 caption options."""
    platform_hint = PLATFORM_HINTS.get(platform.lower(), PLATFORM_HINTS["instagram"])
    tone_hint     = TONE_HINTS.get(tone.lower(), TONE_HINTS["casual"])
    extra = f"\nExtra context from the user: {extra_context.strip()}" if extra_context.strip() else ""

    system_msg = (
        "You are an expert social media copywriter. "
        "You craft highly engaging captions tailored to each platform and tone."
    )
    user_msg = (
        f"Image description: {description}{extra}\n\n"
        f"Platform: {platform.capitalize()}\n"
        f"{platform_hint}\n"
        f"Tone: {tone.capitalize()} — {tone_hint}\n\n"
        "Generate EXACTLY 3 distinct caption options. "
        "Label each as 'Option 1:', 'Option 2:', 'Option 3:'. "
        "Do NOT add any other text before or after the options."
    )

    messages = [
        {"role": "system", "content": system_msg},
        {"role": "user",   "content": user_msg},
    ]

    response = hf_client.chat_completion(
        messages=messages,
        max_tokens=512,
        temperature=0.85,
        top_p=0.92,
    )
    raw = response.choices[0].message.content.strip()

    import re
    # Split text by "Option X:" or "X." or "**Option X:**" etc.
    # This regex looks for common prefix patterns at the start of a line.
    pattern = r"(?i)(?:^|\n)\s*(?:\*?\*?Option\s*\d+\*?\*?:?|\d+\.)"
    parts = re.split(pattern, raw)
    
    captions = []
    for p in parts:
        cleaned = p.strip()
        # Clean out common hallucinated tokens from Zephyr/Mistral models
        for token in ["[/ASS]", "[INST]", "[/USER]", "</s>", "<|user|>", "<|assistant|>"]:
            if token in cleaned:
                cleaned = cleaned.split(token)[0].strip()
        
        # Remove any leading "- " or "* "
        if cleaned.startswith("- ") or cleaned.startswith("* "):
            cleaned = cleaned[2:].strip()
            
        if cleaned and len(cleaned) > 5:
            captions.append(cleaned)
    
    # Fallback if parsing failed
    if not captions:
        captions = ["Could not parse the AI response. Please try again!"]

    # Fill up to 3 to avoid UI issues
    while len(captions) < 3:
        captions.append(captions[-1] if captions else "AI could not generate enough options.")

    return captions[:3]


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────
@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/api/generate", methods=["POST"])
def api_generate():
    try:
        data = request.get_json(force=True)
        image_b64 = data.get("image")          # base64 string (data URL or raw)
        platform   = data.get("platform", "instagram")
        tone       = data.get("tone", "casual")
        extra      = data.get("extra", "")

        if not image_b64:
            return jsonify({"error": "No image provided"}), 400

        # Strip data-URL prefix if present
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]

        img_bytes = base64.b64decode(image_b64)
        pil_image = Image.open(io.BytesIO(img_bytes))
        
        # Force image to RGB and ensure it's not None
        if pil_image is None:
            return jsonify({"error": "Failed to decode image"}), 400
        
        pil_image = pil_image.convert("RGB")

        # Step 1 – Vision description
        description = describe_image(pil_image)

        # Step 2 – Caption generation
        captions = generate_captions(description, platform, tone, extra)

        return jsonify({
            "description": description,
            "captions": captions,
            "platform": platform,
            "tone": tone,
        })

    except Exception as exc:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 7860)), debug=True)
