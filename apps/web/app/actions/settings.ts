'use server';

import fs from 'fs';
import path from 'path';
import { getSession } from '../../lib/session';

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
