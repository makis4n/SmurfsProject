export async function runNER(text) {
  const response = await fetch("http://localhost:8000/ner", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  const data = await response.json();
  return data.entities;
}
