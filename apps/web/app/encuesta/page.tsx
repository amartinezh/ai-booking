import { redirect } from 'next/navigation';

// Acceso a /encuesta SIN token: no hay nada que calificar → al Home corporativo.
export default function EncuestaSinToken() {
  redirect('/');
}
