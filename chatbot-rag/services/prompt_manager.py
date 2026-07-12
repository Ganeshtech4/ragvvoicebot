import os

class PromptManager:
    def __init__(self, prompts_dir: str = None):
        if prompts_dir is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            prompts_dir = os.path.join(base_dir, "prompts")
        self.prompts_dir = prompts_dir

    def _read_prompt(self, filename: str) -> str:
        filepath = os.path.join(self.prompts_dir, filename)
        if not os.path.exists(filepath):
            return ""
        with open(filepath, "r", encoding="utf-8") as f:
            return f.read().strip()

    def build_system_prompt(self, context: str, is_voice: bool = False) -> str:
        system = self._read_prompt("system.md")
        rag_template = self._read_prompt("rag.md")
        
        context_str = context if context else "No knowledge base context found."
        rag_formatted = rag_template.replace("{{context}}", context_str)
        
        combined = f"{system}\n\n{rag_formatted}"
        
        if is_voice:
            voice_style = self._read_prompt("voice.md")
            combined = f"{combined}\n\n{voice_style}"
            
        return combined
