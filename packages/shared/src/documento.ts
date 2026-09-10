// ─────────────────────────────────────────────────────────────
// DOCUMENTO DE IDENTIDAD — normalización única, compartida por el importador
// del padrón y los dos portones de agendamiento (chatbot y staff).
//
// Antes divergía: el importador hacía `.replace(/[.\s]/g, '')` (dejaba pasar
// letras) y los portones `.replace(/\D/g, '')` (quitaba cualquier no-dígito).
// Eran compatibles para "1.234.567", pero ninguno de los dos quitaba ceros a
// la izquierda — así que si el padrón trae "0012345" y el paciente escribe
// "12345" (Excel se come los ceros de una celda numérica al exportar), se
// rechazaba a alguien con derecho real. Ver docs/drivers/cnt-sanvicente-
// anserma/ESTADO.md, "Normalización del documento: una función, dos pasadas".
// ─────────────────────────────────────────────────────────────

/**
 * Normaliza un documento a solo dígitos. Es la ÚNICA función que debe usarse
 * para comparar un documento contra el padrón o contra el HIS.
 *
 * NO quita ceros a la izquierda a propósito: "0012345" y "12345" son cadenas
 * distintas aquí. Fusionarlas en la normalización de base arriesgaría unir
 * dos documentos legítimamente distintos (raro, pero posible en NUIP de
 * menores). Para el segundo intento cuando la búsqueda exacta no encuentra
 * nada, usar `documentoSinCerosIniciales`.
 */
export function normalizeDocumento(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/**
 * Variante sin ceros a la izquierda, para un SEGUNDO intento de búsqueda
 * cuando `normalizeDocumento` no encontró nada. Nunca usar como primera
 * pasada ni para decidir unicidad: solo como fallback de lectura.
 *
 * "0" → "0" (no colapsa un documento de puros ceros a cadena vacía; ese caso
 * ya lo descarta `esDocumentoValido`).
 */
export function documentoSinCerosIniciales(normalizado: string): string {
  const sinCeros = normalizado.replace(/^0+/, '');
  return sinCeros || '0';
}

/**
 * Un documento válido tiene entre 4 y 15 dígitos y al menos uno distinto de
 * cero. La segunda condición cierra un hueco real: el HIS del hospital piloto
 * tiene historias literales "0", "0000", "0000000001" que no son el
 * documento de nadie (medido en PADRON_DESCUBRIMIENTO_2.sql, sección D.1) —
 * un `^\d{4,15}$` a secas las deja pasar.
 */
export function esDocumentoValido(normalizado: string): boolean {
  return normalizado.length >= 4 && normalizado.length <= 15 && /[1-9]/.test(normalizado);
}
