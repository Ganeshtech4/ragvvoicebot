from adapters.base import BaseAIAdapter
from typing import AsyncGenerator, List, Dict
import asyncio

class MockAdapter(BaseAIAdapter):
    async def stream_chat(
        self,
        system_prompt: str,
        history: List[Dict[str, str]],
        prompt: str
    ) -> AsyncGenerator[str, None]:
        lower_prompt = prompt.lower()
        context = system_prompt.lower()
        
        if "password" in lower_prompt or "reset" in lower_prompt:
            responseText = (
                "To reset your password, you should go to the TechSupport Portal. "
                "Click on 'Forgot Password' and check your registered email for the link. "
                "Make sure your new password is at least 12 characters long and contains "
                "both a number and a special character."
            )
        elif "vpn" in lower_prompt or "connect" in lower_prompt:
            responseText = (
                "You can configure your company VPN using Cisco Secure Client. "
                "You'll need to download it internally, point it to 'vpn.techcorp.com', "
                "and log in using your Active Directory username, password, and Duo MFA."
            )
        elif "printer" in lower_prompt or "print" in lower_prompt:
            responseText = (
                "For printer issues, try restarting the print spooler in Windows. "
                "Open an Administrator command prompt and run: 'net stop spooler' "
                "followed by 'net start spooler'. Also, verify if you can ping the "
                "printer at IP 192.168.1.150."
            )
        elif "flu" in lower_prompt or "fever" in lower_prompt or "sick" in lower_prompt:
            responseText = (
                "For general flu care, please get plenty of rest and stay hydrated by "
                "drinking water or clear broths. Ibuprofen or acetaminophen can help with "
                "fever and aches. If you have any difficulty breathing, seek emergency "
                "medical care immediately."
            )
        elif "cancel" in lower_prompt or "appointment" in lower_prompt:
            responseText = (
                "Our cancellation policy requires you to cancel at least 24 hours prior "
                "to your appointment to avoid a $25 late cancellation fee. You can cancel "
                "through our online patient portal or by calling our service line directly."
            )
        elif "diet" in lower_prompt or "eat" in lower_prompt or "food" in lower_prompt:
            responseText = (
                "For a healthy diet, we suggest focusing on whole grains, vegetables, "
                "fresh fruits, lean proteins, and healthy fats. Remember to limit processed "
                "foods, added sugars, and saturated fats, and aim to drink at least 8 glasses "
                "of water a day."
            )
        elif "title" in context:
            retrieved_part = system_prompt.split("Retrieved Context:")[-1].strip()
            responseText = f"According to your documents, here is what I found:\n\n{retrieved_part}\n\nLet me know if you need more details!"
        else:
            responseText = (
                "Hello! I am your AI assistant. I couldn't find any specific documents "
                "relating to your query in your tenant's knowledge base. Please let me know "
                "how I can help you, or ask about password resets, VPN, printers, flu care, "
                "or appointments."
            )

        words = responseText.split(" ")
        for word in words:
            yield word + " "
            await asyncio.sleep(0.06)
