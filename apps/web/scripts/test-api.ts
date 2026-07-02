import { PrismaClient } from '@agenia/database';
import { SignJWT } from 'jose';

const prisma = new PrismaClient();
if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET no está configurado (mismo valor que usa la app).');
}
const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET);

async function main() {
    const user = await prisma.user.findUnique({ where: { email: 'admin@sanvicente.com' } });
    if (!user) throw new Error('User not found');

    const token = await new SignJWT({ 
        userId: user.id, 
        email: user.email, 
        role: user.role,
        organizationId: user.organizationId 
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('8h')
        .sign(SECRET_KEY);

    console.log(`Token created. role: ${user.role}, orgId: ${user.organizationId}`);

    const res = await fetch('http://localhost:3001/analytics', {
        headers: { Authorization: `Bearer ${token}` }
    });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Body: ${text}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
