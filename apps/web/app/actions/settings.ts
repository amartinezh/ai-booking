'use server';

import fs from 'fs';
import path from 'path';
import { getSession } from '../../lib/session';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { CommunicationStyle } from '@antigravity/database';

const DEFAULT_BOT_NAME = 'AgenIA';

export type CommStyle = 'FORMAL' | 'INFORMAL';

export async function getEnvVars() {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') {
        throw new Error('Unauthorized');
    }

    // Path to the API's .env which holds most variables
    const apiEnvPath = path.join(process.cwd(), '../api/.env');
    
    if (!fs.existsSync(apiEnvPath)) {
        return [];
    }

    const content = fs.readFileSync(apiEnvPath, 'utf-8');
    const lines = content.split('\n');
    
    const vars: { key: string, value: string }[] = [];
    
    lines.forEach(line => {
        const trimmed = line.trim();
        // Ignore empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) return;
        
        // Find first = 
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            // Remove surround quotes if they exist
            let val = trimmed.slice(eqIdx + 1).trim();
            if (val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1);
            } else if (val.startsWith("'") && val.endsWith("'")) {
                val = val.slice(1, -1);
            }
            vars.push({ key, value: val });
        }
    });

    return vars;
}

export async function saveEnvVars(vars: { key: string, value: string }[]) {
    try {
        const session = await getSession();
        if (!session || session.role !== 'SUPER_ADMIN') {
            return { success: false, error: 'Unauthorized' };
        }

        const apiEnvPath = path.join(process.cwd(), '../api/.env');
        const webEnvPath = path.join(process.cwd(), '.env');
        const dbEnvPath = path.join(process.cwd(), '../../packages/database/.env');
        
        // Reconstruct string
        let contentStr = '';
        let dbUrl = '';

        vars.forEach(v => {
            if (v.key && v.key.trim() !== '') {
                contentStr += `${v.key}="${v.value}"\n`;
                if (v.key === 'DATABASE_URL') dbUrl = v.value;
            }
        });

        // Write to API
        fs.writeFileSync(apiEnvPath, contentStr, 'utf-8');

        // Write to Web (just to keep DB URL or exact copy since Next.js parses it too)
        fs.writeFileSync(webEnvPath, contentStr, 'utf-8');

        // Write strictly DB URL to the database package for Prisma schema commands
        if (dbUrl) {
            fs.writeFileSync(dbEnvPath, `DATABASE_URL="${dbUrl}"\n`, 'utf-8');
        }

        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

// ─── Configuración de Organización (botName, etc.) ───────────────────────────

export async function getMyOrgSettings() {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') throw new Error('Acceso denegado');

    const s = await prisma.organizationSettings.findUnique({
        where: { organizationId: session.organizationId! },
        select: { botName: true, communicationStyle: true },
    });
    return {
        botName: s?.botName ?? DEFAULT_BOT_NAME,
        communicationStyle: (s?.communicationStyle ?? 'FORMAL') as CommStyle,
    };
}

export async function updateMyOrgSettings(data: { botName: string; communicationStyle?: CommStyle }) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    const botName = data.botName.trim() || DEFAULT_BOT_NAME;
    const communicationStyle: CommunicationStyle = data.communicationStyle === 'INFORMAL' ? 'INFORMAL' : 'FORMAL';
    try {
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId! },
            create: { organizationId: session.organizationId!, botName, communicationStyle },
            update: { botName, communicationStyle },
        });
        revalidatePath('/dashboard/configuracion');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function getOrgSettingsForOrg(organizationId: string) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');

    const s = await prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: { botName: true, communicationStyle: true },
    });
    return {
        botName: s?.botName ?? DEFAULT_BOT_NAME,
        communicationStyle: (s?.communicationStyle ?? 'FORMAL') as CommStyle,
    };
}

export async function updateOrgSettingsForOrg(
    organizationId: string,
    data: { botName: string; communicationStyle?: CommStyle },
) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') return { success: false, error: 'Acceso denegado' };

    const botName = data.botName.trim() || DEFAULT_BOT_NAME;
    const communicationStyle: CommunicationStyle = data.communicationStyle === 'INFORMAL' ? 'INFORMAL' : 'FORMAL';
    try {
        await prisma.organizationSettings.upsert({
            where: { organizationId },
            create: { organizationId, botName, communicationStyle },
            update: { botName, communicationStyle },
        });
        revalidatePath('/super-admin/organizations');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
