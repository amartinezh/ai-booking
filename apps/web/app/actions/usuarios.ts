'use server'

import { prisma } from '../../lib/prisma';
import bcrypt from 'bcryptjs';

export interface CreateAgentInput {
  email: string;
  fullName: string;
  phone?: string;
  epsId?: string | null;
  doctorId?: string | null;
  password?: string;
}

export async function createBookingAgent(data: CreateAgentInput) {
  try {
    const { email, fullName, phone, epsId, doctorId, password } = data;

    // 1. Validar si ya existe
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return { success: false, error: 'El correo electrónico ya está registrado.' };
    }

    // 2. Hash Password (o clave por defecto)
    const rawPassword = password || 'sanvicente123';
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    // 3. Transacción para crear Usuario + Perfil de Agente
    const newAgent = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          role: 'BOOKING_AGENT'
        }
      });

      const profile = await tx.agentProfile.create({
        data: {
          userId: user.id,
          fullName,
          phone: phone || null,
          epsId: epsId || null,
          doctorId: doctorId || null,
        }
      });

      return { user, profile };
    });

    return { success: true, agent: newAgent };

  } catch (error: any) {
    console.error('Error creando BOOKING_AGENT:', error);
    return { success: false, error: error.message || 'Error interno al crear el agente' };
  }
}
