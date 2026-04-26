import re

with open('apps/api/src/chatbot/chatbot.service.ts', 'r') as f:
    content = f.read()

# Fix 1: The Outbound message missing organizationId
content = re.sub(
    r'async sendOutboundMessage\(to: string, message: string\) \{\s+// Usamos(.*?)await this\.smartReply\(to, message\);\s+\}',
    """async sendOutboundMessage(to: string, message: string) {
    // [Modificado por IA] Necesitamos resolver el tenant para poder invocar smartReply o mantener la firma del método
    const origin = await this.redis.get(`origin_phone:${to}`);
    if (!origin) throw new Error("No hay tenant asociado temporal para outboud message");
    const org = await this.prisma.organization.findFirst({ where: { metaPhoneId: origin } });
    if (!org) throw new Error("No org");
    await this.smartReply(org.id, to, message);
  }""",
    content,
    flags=re.DOTALL
)

# Fix 2: Prisma isolate patients Data Isolation
content = re.sub(
    r'([a-zA-Z0-9_]+)\s*=\s*await this\.prisma\.patientProfile\.findUnique\(\{\s*where:\s*\{\s*cedula([:\s\, a-zA-Z0-9_\']*)\}\s*\}\)',
    r'\1 = await this.prisma.patientProfile.findFirst({ where: { cedula\2, organizationId } })',
    content
)

# Fix 3: And create...
content = re.sub(
    r'let patient = await this\.prisma\.patientProfile\.findFirst\(\{\s*where:\s*\{\s*cedula: finalCedula,\s*organizationId\s*\}(\s*.*?)\}\);(.*?)patient = await this\.prisma\.patientProfile\.create\(\{\s*data:\s*\{\s*cedula: finalCedula,\s*fullName: finalNombre,\s*phone: senderId\s*\}\s*\}\);',
    r'let patient = await this.prisma.patientProfile.findFirst({ where: { cedula: finalCedula, organizationId }\1});\2patient = await this.prisma.patientProfile.create({ data: { cedula: finalCedula, fullName: finalNombre, phone: senderId, organizationId } });',
    content,
    flags=re.DOTALL
)

with open('apps/api/src/chatbot/chatbot.service.ts', 'w') as f:
    f.write(content)
