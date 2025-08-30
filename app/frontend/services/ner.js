import Constants from "expo-constants";

function getApiUrl() {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return `http://${host || "localhost"}:8000`;
}
export async function runNER(text) {
  const response = await fetch(`${getApiUrl()}/ner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  const data = await response.json();
  return data.entities;
}
