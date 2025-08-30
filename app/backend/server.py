from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoTokenizer, AutoModelForTokenClassification, pipeline

app = FastAPI()

tokenizer = AutoTokenizer.from_pretrained("dslim/distilbert-NER")
model = AutoModelForTokenClassification.from_pretrained("dslim/distilbert-NER")

nlp = pipeline("ner", model=model, tokenizer=tokenizer)

class InputText(BaseModel):
    text: str

@app.post("/ner")
def ner_endpoint(input: InputText):
    raw_results = nlp(input.text)
    results = []
    for r in raw_results:
      results.append({
        "entity": str(r["entity"]),
        "score": float(r["score"]),
        "index": int(r["index"]),
        "word": str(r["word"]),
        "start": int(r["start"]),
        "end": int(r["end"])
      })
    print(results)
    return {"embedding": results}