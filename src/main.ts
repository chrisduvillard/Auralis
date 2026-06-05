import { mountVoiceToTextApp } from "./app";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("App root element was not found.");
}

mountVoiceToTextApp(root, window);
