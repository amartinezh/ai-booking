/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { createClinicalRecord } from '@/app/actions/ehr';
import { X, Plus, Trash2, Save, Stethoscope, FileText, ClipboardList } from 'lucide-react';

const ehrSchema = z.object({
    vitalSigns: z.object({
        bloodPressure: z.string().optional(),
        heartRate: z.coerce.number().optional().or(z.literal('')),
        temperature: z.coerce.number().optional().or(z.literal('')),
        weight: z.coerce.number().optional().or(z.literal('')),
        height: z.coerce.number().optional().or(z.literal('')),
        oxygenSat: z.coerce.number().optional().or(z.literal(''))
    }),
    chiefComplaint: z.string().min(5, 'El motivo de consulta es requerido (min 5 chars)'),
    currentIllness: z.string().min(5, 'La enfermedad actual es requerida'),
    physicalExam: z.string().optional(),
    evolutionNotes: z.string().optional(),
    diagnoses: z.array(z.object({
        code: z.string().optional(),
        description: z.string().min(3, 'Requerido'),
        isMain: z.boolean().optional()
    })).min(1, 'Debe registrar al menos un diagnóstico principal'),
    prescriptions: z.array(z.object({
        medication: z.string().min(2, 'Requerido'),
        dose: z.string().min(1, 'Requerido'),
        frequency: z.string().min(1, 'Requerido'),
        duration: z.string().min(1, 'Requerido'),
        notes: z.string().optional()
    }))
});

type EhrFormValues = z.infer<typeof ehrSchema>;

export default function ClinicalRecordDrawer({
    appointment,
    onClose
}: {
    appointment: any,
    onClose: () => void
}) {
    const [activeTab, setActiveTab] = useState<'vitals' | 'notes' | 'plan'>('vitals');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { register, control, handleSubmit, formState: { errors } } = useForm<EhrFormValues>({
        resolver: zodResolver(ehrSchema),
        defaultValues: {
            diagnoses: [{ description: '', code: '', isMain: true }],
            prescriptions: [],
            vitalSigns: {}
        }
    });

    const { fields: dxFields, append: appendDx, remove: removeDx } = useFieldArray({ control, name: 'diagnoses' });
    const { fields: rxFields, append: appendRx, remove: removeRx } = useFieldArray({ control, name: 'prescriptions' });

    const onSubmit = async (data: EhrFormValues) => {
        setIsSubmitting(true);
        // Cast empty strings mapping in vitals to undefined or numbers to follow Prisma
        const cleanVitals = Object.fromEntries(
            Object.entries(data.vitalSigns).map(([k, v]) => [k, v === '' ? null : v])
        );

        const payload = {
            ...data,
            vitalSigns: Object.keys(cleanVitals).length > 0 ? cleanVitals : undefined,
            appointmentId: appointment.id,
            patientId: appointment.patient.id,
            doctorId: appointment.scheduleSlot.doctor.id
        };

        const res = await createClinicalRecord(payload);
        setIsSubmitting(false);

        if (res.success) {
            alert('Historia Clínica guardada exitosamente.');
            onClose();
        } else {
            alert(res.error);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm transition-opacity">
            <div className="w-full max-w-4xl bg-white dark:bg-zinc-900 h-full shadow-2xl flex flex-col animate-slide-in-right">
                
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                    <div>
                        <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                            📝 Historia Clínica Electrónica
                        </h2>
                        <p className="text-sm text-zinc-500 mt-1">
                            Paciente: <strong className="text-zinc-700 dark:text-zinc-300">{appointment.patient.fullName}</strong> (DNI: {appointment.patient.cedula})
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-zinc-200 dark:bg-zinc-800 rounded-full hover:bg-zinc-300 dark:hover:bg-zinc-700 transition">
                        <X className="w-5 h-5 text-zinc-600 dark:text-zinc-300" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-zinc-200 dark:border-zinc-800 px-6 pt-2 bg-white dark:bg-zinc-900">
                    <button onClick={() => setActiveTab('vitals')} className={`flex items-center gap-2 px-6 py-3 font-semibold text-sm border-b-2 transition-colors ${activeTab === 'vitals' ? 'border-blue-600 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}>
                        <Stethoscope className="w-4 h-4" /> Triage y Vítales
                    </button>
                    <button onClick={() => setActiveTab('notes')} className={`flex items-center gap-2 px-6 py-3 font-semibold text-sm border-b-2 transition-colors ${activeTab === 'notes' ? 'border-blue-600 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}>
                        <FileText className="w-4 h-4" /> Anamnesis y Notas
                    </button>
                    <button onClick={() => setActiveTab('plan')} className={`flex items-center gap-2 px-6 py-3 font-semibold text-sm border-b-2 transition-colors ${activeTab === 'plan' ? 'border-blue-600 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}>
                        <ClipboardList className="w-4 h-4" /> Diagnóstico y Plan
                    </button>
                </div>

                {/* Form Content */}
                <div className="flex-1 overflow-y-auto bg-zinc-50/50 dark:bg-black/20 p-6">
                    <form id="ehr-form" onSubmit={handleSubmit(onSubmit)} className="space-y-8">
                        
                        {/* TAB 1: VITALS */}
                        <div className={activeTab === 'vitals' ? 'block' : 'hidden'}>
                            <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-200 mb-4">Signos Vitales</h3>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-xs font-semibold text-zinc-500 mb-1">Tensión Arterial</label>
                                    <div className="relative">
                                        <input {...register('vitalSigns.bloodPressure')} placeholder="120/80" className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm pr-12 focus:ring-blue-500 font-mono" />
                                        <span className="absolute right-3 top-2 text-xs text-zinc-400">mmHg</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-zinc-500 mb-1">Frecuencia Cardíaca</label>
                                    <div className="relative">
                                        <input type="number" {...register('vitalSigns.heartRate')} placeholder="80" className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm pr-10 focus:ring-blue-500 font-mono" />
                                        <span className="absolute right-3 top-2 text-xs text-zinc-400">lpm</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-zinc-500 mb-1">Temperatura</label>
                                    <div className="relative">
                                        <input type="number" step="0.1" {...register('vitalSigns.temperature')} placeholder="36.5" className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm pr-8 focus:ring-blue-500 font-mono" />
                                        <span className="absolute right-3 top-2 text-xs text-zinc-400">°C</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-zinc-500 mb-1">Saturación O2</label>
                                    <div className="relative">
                                        <input type="number" {...register('vitalSigns.oxygenSat')} placeholder="98" className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm pr-8 focus:ring-blue-500 font-mono" />
                                        <span className="absolute right-3 top-2 text-xs text-zinc-400">%</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-zinc-500 mb-1">Peso</label>
                                    <div className="relative">
                                        <input type="number" step="0.1" {...register('vitalSigns.weight')} placeholder="70.5" className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm pr-8 focus:ring-blue-500 font-mono" />
                                        <span className="absolute right-3 top-2 text-xs text-zinc-400">kg</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-zinc-500 mb-1">Talla</label>
                                    <div className="relative">
                                        <input type="number" {...register('vitalSigns.height')} placeholder="175" className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm pr-8 focus:ring-blue-500 font-mono" />
                                        <span className="absolute right-3 top-2 text-xs text-zinc-400">cm</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* TAB 2: NOTES */}
                        <div className={activeTab === 'notes' ? 'block' : 'hidden'}>
                            <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-200 mb-4">Anamnesis y Examen Físico</h3>
                            <div className="space-y-5">
                                <div>
                                    <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">S - Motivo de Consulta <span className="text-red-500">*</span></label>
                                    <textarea {...register('chiefComplaint')} rows={2} className={`w-full bg-white dark:bg-zinc-900 border rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 ${errors.chiefComplaint ? 'border-red-500' : 'border-zinc-300 dark:border-zinc-700'}`} placeholder="¿Por qué acude el paciente hoy?"></textarea>
                                    {errors.chiefComplaint && <span className="text-xs text-red-500 mt-1">{errors.chiefComplaint.message}</span>}
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">O - Enfermedad Actual <span className="text-red-500">*</span></label>
                                    <textarea {...register('currentIllness')} rows={4} className={`w-full bg-white dark:bg-zinc-900 border rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 ${errors.currentIllness ? 'border-red-500' : 'border-zinc-300 dark:border-zinc-700'}`} placeholder="Descripción detallada de la enfermedad..."></textarea>
                                    {errors.currentIllness && <span className="text-xs text-red-500 mt-1">{errors.currentIllness.message}</span>}
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Examen Físico</label>
                                    <textarea {...register('physicalExam')} rows={4} className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500" placeholder="Hallazgos al examen físico..."></textarea>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Notas de Evolución</label>
                                    <textarea {...register('evolutionNotes')} rows={3} className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500" placeholder="Apreciaciones clínicas adicionales..."></textarea>
                                </div>
                            </div>
                        </div>

                        {/* TAB 3: PLAN */}
                        <div className={activeTab === 'plan' ? 'block' : 'hidden'}>
                            <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-200 mb-4">A - Diagnóstico</h3>
                            
                            <div className="space-y-4 mb-8">
                                {dxFields.map((field, index) => (
                                    <div key={field.id} className="flex gap-4 items-start bg-white dark:bg-zinc-800 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">
                                        <div className="flex-1 space-y-3">
                                            <div className="flex gap-4">
                                                <div className="flex-1">
                                                    <input {...register(`diagnoses.${index}.description`)} placeholder="Descripción del Diagnóstico" className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 text-sm" />
                                                    {errors.diagnoses?.[index]?.description && <span className="text-xs text-red-500">{errors.diagnoses[index]?.description?.message}</span>}
                                                </div>
                                                <div className="w-32">
                                                    <input {...register(`diagnoses.${index}.code`)} placeholder="CIE-10 (Opc.)" className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono uppercase" />
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input type="checkbox" {...register(`diagnoses.${index}.isMain`)} id={`dx-main-${index}`} className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500" />
                                                <label htmlFor={`dx-main-${index}`} className="text-xs text-zinc-600 dark:text-zinc-400">Diagnóstico Principal</label>
                                            </div>
                                        </div>
                                        <button type="button" onClick={() => removeDx(index)} className="mt-1 p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                                <button type="button" onClick={() => appendDx({ description: '', code: '', isMain: false })} className="text-sm font-semibold text-blue-600 flex items-center gap-1 hover:text-blue-700">
                                    <Plus className="w-4 h-4" /> Agregar Diagnóstico Secundario
                                </button>
                                {errors.diagnoses && <p className="text-xs text-red-500 mt-1">{errors.diagnoses.message}</p>}
                            </div>

                            <hr className="border-zinc-200 dark:border-zinc-800 mb-6" />

                            <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-200 mb-4">P - Receta Médica (Plan)</h3>
                            <div className="space-y-4">
                                {rxFields.map((field, index) => (
                                    <div key={field.id} className="bg-white dark:bg-zinc-800 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
                                            <div className="lg:col-span-2">
                                                <label className="block text-xs font-semibold text-zinc-500 mb-1">Medicamento</label>
                                                <input {...register(`prescriptions.${index}.medication`)} placeholder="Ej: Acetaminofén 500mg" className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 text-sm" />
                                                {errors.prescriptions?.[index]?.medication && <span className="text-xs text-red-500">{errors.prescriptions[index]?.medication?.message}</span>}
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-zinc-500 mb-1">Dosis</label>
                                                <input {...register(`prescriptions.${index}.dose`)} placeholder="Ej: 1 tableta" className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 text-sm" />
                                                {errors.prescriptions?.[index]?.dose && <span className="text-xs text-red-500">{errors.prescriptions[index]?.dose?.message}</span>}
                                            </div>
                                            <div className="flex gap-2 items-end">
                                                <div className="flex-1">
                                                    <label className="block text-xs font-semibold text-zinc-500 mb-1">Frecuencia</label>
                                                    <input {...register(`prescriptions.${index}.frequency`)} placeholder="Cada 8h" className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 text-sm" />
                                                    {errors.prescriptions?.[index]?.frequency && <span className="text-xs text-red-500">{errors.prescriptions[index]?.frequency?.message}</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                                            <div>
                                                <label className="block text-xs font-semibold text-zinc-500 mb-1">Duración</label>
                                                <input {...register(`prescriptions.${index}.duration`)} placeholder="Por 5 días" className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 text-sm" />
                                                {errors.prescriptions?.[index]?.duration && <span className="text-xs text-red-500">{errors.prescriptions[index]?.duration?.message}</span>}
                                            </div>
                                            <div className="md:col-span-2 flex gap-4 items-end">
                                                <div className="flex-1">
                                                    <label className="block text-xs font-semibold text-zinc-500 mb-1">Indicaciones Adicionales</label>
                                                    <input {...register(`prescriptions.${index}.notes`)} placeholder="Tomar después de comidas..." className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 text-sm" />
                                                </div>
                                                <button type="button" onClick={() => removeRx(index)} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition mb-0.5 border border-red-200 dark:border-transparent">
                                                    <Trash2 className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                <button type="button" onClick={() => appendRx({ medication: '', dose: '', frequency: '', duration: '', notes: '' })} className="text-sm font-semibold text-emerald-600 flex items-center gap-1 hover:text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-lg transition">
                                    <Plus className="w-4 h-4" /> Formular Medicamento
                                </button>
                            </div>
                        </div>
                    </form>
                </div>

                {/* Footer / Actions */}
                <div className="p-6 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex justify-end gap-4">
                    <button type="button" onClick={onClose} className="px-6 py-2.5 rounded-xl font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition">
                        Cancelar
                    </button>
                    <button 
                        type="submit" 
                        form="ehr-form" 
                        disabled={isSubmitting}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-2.5 rounded-xl font-bold shadow-md shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <Save className="w-5 h-5" />
                        )}
                        Cerrar y Firmar Historia Clínica
                    </button>
                </div>

            </div>
        </div>
    );
}
