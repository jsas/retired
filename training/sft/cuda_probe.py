# Probe: is CUDA visible to transformers in this env, and does a direct
# checkpoint-500 generate work on GPU?
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

print('cuda available:', torch.cuda.is_available())
print('torch:', torch.__version__)

tok = AutoTokenizer.from_pretrained('training/sft/out/checkpoint-500')
model = AutoModelForCausalLM.from_pretrained(
    'training/sft/out/checkpoint-500', torch_dtype=torch.bfloat16, device_map='cuda'
)
print('device:', next(model.parameters()).device)

msgs = [{'role': 'user', 'content': 'Am I on track for retirement?'}]
ids = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors='pt').to('cuda')
out = model.generate(ids, max_new_tokens=80, do_sample=False)
print('GEN:', tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True))
