# MyAssistantIA

Aplicación de organización con React, Vite, Firebase Authentication y Cloud Firestore. Cada persona puede registrarse con correo y contraseña o iniciar sesión con Google. Sus tareas, eventos, rutinas, movimientos, racha de estudio y preferencias de Pomodoro se sincronizan en documentos privados asociados a su UID de Firebase.

## Requisitos

- Node.js 20.19 o posterior
- npm

## Desarrollo

```bash
npm install
npm run dev
```

La configuración local de Firebase está en `.env.local`, excluido de Git. Para otra instalación, copia `.env.example` a `.env.local` y completa los valores de **Firebase Console > Project settings > Your apps**. Reinicia Vite después de editar variables.

## Activar Firebase

1. En **Firebase Console > Authentication > Sign-in method**, habilita **Email/Password** y **Google**.
2. En **Authentication > Settings > Authorized domains**, agrega el dominio donde se ejecutará la app. `localhost` suele estar disponible para desarrollo.
3. Crea una base de datos en **Firestore Database**.
4. Publica las reglas incluidas en `firestore.rules` desde la pestaña **Rules** de Firestore o con Firebase CLI:

   ```bash
   firebase deploy --only firestore:rules
   ```

Las reglas solo permiten que cada usuario lea y escriba debajo de `users/{su-uid}`. No reemplaces estas reglas por acceso público. La clave web de Firebase identifica el proyecto, pero los permisos de los datos los aplican Authentication y las reglas de Firestore.

El registro por correo envía un enlace de verificación. La sección de estudio acepta archivos `.txt` y `.md` de hasta 2 MB y genera resumen/tarjetas localmente; todavía no utiliza un servicio de IA ni sube los documentos.

Para generar y previsualizar la versión de producción:

```bash
npm run build
npm run preview
```

La app mantiene una copia local por UID para acelerar la carga. Los documentos personales se sincronizan con Cloud Firestore y no se comparten entre cuentas.
