from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoTokenizer, AutoModelForTokenClassification, pipeline

app = FastAPI()

tokenizer = AutoTokenizer.from_pretrained("iiiorg/piiranha-v1-detect-personal-information")
model = AutoModelForTokenClassification.from_pretrained("iiiorg/piiranha-v1-detect-personal-information")

nlp = pipeline("ner", model=model, tokenizer=tokenizer)

class InputText(BaseModel):
    text: str

@app.post("/ner")
def ner_endpoint(input: InputText):
    raw_results = nlp(input.text)
    results = []
    current_entity = None

    for r in raw_results:
      entity = r["entity"].split("-")[-1]  # e.g. "I-USERNAME" -> "USERNAME"
      word = r["word"].replace("▁", "")   # remove special tokens like ▁

      if current_entity and current_entity["entity"] == entity:
        # continue same entity
        current_entity["word"] += word
        current_entity["end"] = int(r["end"])
        current_entity["score"] = (current_entity["score"] + float(r["score"])) / 2

      else:
        # start new entity
        if current_entity:
          results.append(current_entity)
        current_entity = {
          "entity": entity,
          "word": word,
          "score": float(r["score"]),
          "start": int(r["start"]),
          "end": int(r["end"]),
        }

    if current_entity:
      results.append(current_entity)

    return {"entities": results}