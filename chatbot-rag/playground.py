import streamlit as st
import asyncio
import os
import sys
from dotenv import load_dotenv

# Add workspace directory to python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

load_dotenv()

from services.prompt_manager import PromptManager
from adapters.factory import get_ai_adapter
from rag.retriever import retrieve_context, compute_embedding
from vector_store.factory import get_vector_store

st.set_page_config(
    page_title="DocuBot AI RAG Playground",
    page_icon="🤖",
    layout="wide"
)

st.title("🤖 DocuBot RAG & LLM Orchestrator Playground")
st.markdown("Use this playground to verify prompt compiles, test LLM streaming adapters, and query tenant-scoped knowledge documents.")

# Sidebar - Settings
st.sidebar.header("🛠️ Configuration")

provider = st.sidebar.selectbox(
    "LLM Provider",
    ["mock", "openai", "groq", "anthropic", "gemini"],
    index=0
)

os.environ["LLM_PROVIDER"] = provider

model = st.sidebar.text_input("Model Override (Optional)", placeholder="e.g. gpt-4o-mini")
if model:
    os.environ["LLM_MODEL"] = model
else:
    if "LLM_MODEL" in os.environ:
        del os.environ["LLM_MODEL"]

api_key = st.sidebar.text_input("API Key (Optional)", type="password")
if api_key:
    os.environ["LLM_API_KEY"] = api_key

st.sidebar.markdown("---")
tenant_id = st.sidebar.text_input("Tenant ID", value="tenant-tech")

# Main Interface Tabs
tab1, tab2, tab3 = st.tabs(["💬 Chat & Stream Testing", "🔍 Context & Vector Query", "📝 Prompt Preview"])

# Tab 1: Chat Testing
with tab1:
    st.subheader("Stream LLM Response")
    
    col1, col2 = st.columns([2, 1])
    
    with col1:
        user_message = st.text_area("User Query", "How do I reset my password?", height=100)
        is_voice = st.checkbox("Format for Voice Interaction (Brief/Conversational)")
        
        if st.button("Send Stream Request", type="primary"):
            async def run_chat():
                # 1. Retrieve context
                with st.spinner("Searching knowledge base..."):
                    context = await retrieve_context(tenant_id, user_message)
                
                if context:
                    st.success("Context retrieved from Qdrant vector store!")
                    with st.expander("Retrieved Document Blocks"):
                        st.text(context)
                else:
                    st.info("No documents found in knowledge base.")

                # 2. Build system prompt
                pm = PromptManager()
                system_prompt = pm.build_system_prompt(context, is_voice=is_voice)
                
                # 3. Stream chat
                adapter = get_ai_adapter()
                st.markdown(f"**Streaming Response via `{adapter.__class__.__name__}`:**")
                
                response_placeholder = st.empty()
                full_text = ""
                
                async for chunk in adapter.stream_chat(system_prompt, [], user_message):
                    full_text += chunk
                    response_placeholder.write(full_text)
                    
            asyncio.run(run_chat())

# Tab 2: Context Query
with tab2:
    st.subheader("Search Qdrant Vectors")
    search_query = st.text_input("Search Text", "VPN configuration")
    top_k = st.slider("Top K Matches", min_value=1, max_value=10, value=3)
    
    if st.button("Query Vector Database"):
        async def run_query():
            store = get_vector_store()
            await store.connect()
            
            vector = compute_embedding(search_query)
            st.write(f"Computed embedding dimensions: {len(vector)}")
            
            hits = await store.search(tenant_id, vector, top_k=top_k)
            
            if not hits:
                st.warning("No matches found in Qdrant database.")
            else:
                for idx, hit in enumerate(hits):
                    st.markdown(f"### Match #{idx + 1} - Score: `{hit.get('score', 0):.4f}`")
                    st.markdown(f"**Title**: {hit.get('title')}")
                    st.text_area(f"Content #{idx+1}", hit.get('content'), height=150, disabled=True)
                    st.markdown("---")
        
        asyncio.run(run_query())

# Tab 3: Prompts Preview
with tab3:
    st.subheader("Markdown Prompt Preview")
    pm = PromptManager()
    
    st.markdown("### System Prompt (`system.md`)")
    st.code(pm._read_prompt("system.md"), language="markdown")
    
    st.markdown("### RAG Prompt Context Wrapper (`rag.md`)")
    st.code(pm._read_prompt("rag.md"), language="markdown")
    
    st.markdown("### Voice Styling (`voice.md`)")
    st.code(pm._read_prompt("voice.md"), language="markdown")
