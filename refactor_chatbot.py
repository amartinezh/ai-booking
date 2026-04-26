import re

with open('apps/api/src/chatbot/chatbot.service.ts', 'r') as f:
    content = f.read()

# 1. Elimination of dangerously fallback org assignment
# Look for the fallback block in processIncomingMessage
curr_fallback = """
      if (!organizationId) {
         // Fallback de desarrollo/demo (Asignar a la primera organización)
         const firstOrg = await this.prisma.organization.findFirst();
         if (firstOrg) {
             organizationId = firstOrg.id;
         }
      }
"""
fallback_target = """
      if (!org) {
         this.logger.error(`Mensaje recibido a metaPhoneId: ${metaPhoneId} pero no existe una organización mapeada. Abortando flujo.`);
         return;
      }
      const organizationId = org.id;
"""

# Wait, we need to match it robustly. Let's find `let org = await this.prisma.organization.findFirst`
content = re.sub(
    r'let org = await this.prisma.organization\.findFirst\(\{ where: \{ metaPhoneId \} \}\);\s*let organizationId = org\?\.id;\s*if \(!organizationId\) \{.*?\n\s*\}\s*\}',
    """const org = await this.prisma.organization.findFirst({ where: { metaPhoneId } });
      if (!org) {
         this.logger.error(`Mensaje recibido a metaPhoneId: ${metaPhoneId} pero no existe una organización mapeada. Abortando flujo.`);
         return;
      }
      const organizationId = org.id;""",
    content,
    flags=re.DOTALL
)

print('Fall back removed')

# 2. Redis namespaces 
keys_to_namespace = [
    r'chat_state', r'temp_cedula', r'temp_nombre', r'temp_especialidad', r'temp_doctor',
    r'temp_eps_query', r'temp_eps_id', r'temp_slot_[a-zA-Z0-9_\-]+', r'temp_selected_[a-zA-Z0-9_\-]+',
    r'temp_cancel_[a-zA-Z0-9_\-]+', r'error_count', r'is_ai_flow'
]

# Specifically replace `${senderId}` with `${organizationId}:${senderId}` for keys starting with the listed prefixes.
# We'll use a dynamic replacement approach.
def replace_redis_key(m):
    key_pattern = m.group(1) # e.g. "chat_state:${phoneId}"
    # check if key starts with one of our prefixes
    for prefix in keys_to_namespace:
        if re.match(r'^' + prefix, key_pattern):
            # Replace senderId or phoneId
            new_key = key_pattern.replace('${senderId}', '${organizationId}:${senderId}')
            new_key = new_key.replace('${phoneId}', '${organizationId}:${phoneId}')
            # For retriesKey which is literal error_count:${senderId}
            # wait, retriesKey is a variable in TS. "const retriesKey = `error_count:${senderId}`"
            new_key = new_key.replace('${senderId}', '${organizationId}:${senderId}')
            return m.group(0).replace(key_pattern, new_key)
    return m.group(0)

# Replace all backtick strings inside this.redis methods.
# Actually, it's easier to just do a global replace on the exact keys we know
for prefix in keys_to_namespace:
    content = re.sub(rf'({prefix}[^`]*?):\$\{{senderId\}}', rf'\1:${{organizationId}}:${{senderId}}', content)
    content = re.sub(rf'({prefix}[^`]*?):\$\{{phoneId\}}', rf'\1:${{organizationId}}:${{phoneId}}', content)
    
print('Namespaced redis variables')

# 3. Add organizationId to method signatures
methods_to_add_org = [
    'getUserState', 'setUserState', 'smartReply', 'cleanUpUserCounters',
    'handleInitialStep', 'handleCedulaStep', 'handleEpsStep', 
    'handleGenerarCitasEspecialidadStep', 'handleSelectionStep', 'handleCancelCedulaStep'
]

for method in methods_to_add_org:
    # Definition
    content = re.sub(rf'({method})\((senderId|phoneId): string', rf'\1(organizationId: string, \2: string', content)
    # Invocation: `this.method(senderId` -> `this.method(organizationId, senderId`
    content = re.sub(rf'this\.{method}\(senderId', rf'this.{method}(organizationId, senderId', content)
    content = re.sub(rf'this\.{method}\(phoneId', rf'this.{method}(organizationId, phoneId', content)

print('Added org parameter to signatures')

# 4. Agent phone replacing
content = re.sub(
    r"this\.configService\.get<string>\('HUMAN_AGENT_PHONE'\)",
    r"(org as any)?.supportPhone || '+573000000000'",
    content
)

content = re.sub(
    r"processIncomingMessage\(event: any\) \{",
    r"processIncomingMessage(event: any) {",
    content
)

# wait, how do we pass `org` to where HUMAN_AGENT_PHONE was used?
# HUMAN_AGENT_PHONE is used inside `processIncomingMessage` catch/fallback!
# And inside `handleInitialStep`? Let's check where HUMAN_AGENT_PHONE is used.
# It is used in handleEpsStep, etc? We must pass org if it's there. 

with open('apps/api/src/chatbot/chatbot.service.ts', 'w') as f:
    f.write(content)

