# ADR 0009: Web en TypeScript sin frameworks, servida por nginx

- **Estado:** Aceptada
- **Fecha:** 2026-11-02

## Contexto

La web tiene tres pantallas: login y registro, reservas, y la pantalla informativa de los edificios. El curso prohíbe React, Angular, Vue, Tailwind, Bootstrap y las librerías de componentes. Aun así, la web tiene que renovar tokens, mostrar errores claros y no abrir la puerta a XSS con los datos que vienen de la API.

## Decisión

- **Vite + TypeScript + HTML y CSS propios.** El enrutado es por hash (`#/login`, `#/reservas`, `#/pantalla`), con un `hashchange` y una tabla de rutas, sin librería de enrutado. El hash evita configurar el servidor para cada ruta.
- **Un solo cliente de API (`src/api.ts`).** Ninguna pantalla llama a `fetch` directamente.
  - Valida cada respuesta con los esquemas de `@reservalab/shared` y traduce los errores a `ApiError` o `NetworkError`.
  - Ante un 401 renueva el access token una sola vez con el refresh token. Si varias solicitudes reciben 401 a la vez, comparten esa renovación.
  - Cada solicitud tiene un tope de 15 s.
- **Sin `innerHTML`.** El DOM se arma con `h()` (`src/dom.ts`), que inserta todo texto como nodo de texto, así que lo que viene de la API nunca se interpreta como HTML. Una prueba falla si algún archivo usa `innerHTML`, `outerHTML`, `insertAdjacentHTML` o `document.write`.
- **Mismo origen.** La web llama a rutas relativas `/api/v1/…`. En desarrollo las reenvía Vite y en Docker nginx (`apps/web/nginx.conf`), así que no hace falta CORS.
- **Tokens en `localStorage`.** Es lo más simple para una SPA sin backend propio. El riesgo es que un XSS podría leerlos, y se mitiga con la regla de no usar `innerHTML`. Al cerrar sesión se llama a `POST /auth/logout`, que revoca el refresh token.
- **Key de la pantalla informativa en el build.** `VITE_INFO_API_KEY` se incrusta en el JavaScript al construir la imagen, así que es pública por diseño. Por eso el seed la registra con **solo** `read:now`. Si se filtra, lo único que permite es leer `/now`, con el límite por minuto de su key, y se revoca sin tocar nada más.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **Frameworks o librerías de componentes** | Prohibidos por el curso. Para tres pantallas tampoco hacen falta. |
| **Rutas con History API** (`/reservas`) | Obliga a que el servidor devuelva `index.html` para cada ruta y a manejar los enlaces. El hash funciona igual con Vite y con nginx sin configuración extra. |
| **Plantillas con `innerHTML` y una función `escape()`** | Basta un dato que alguien olvide escapar para tener un XSS. Con nodos de texto, escapar no depende de acordarse. |
| **Tokens en cookies `HttpOnly`** | Protege mejor contra XSS, pero la API está diseñada con `Authorization: Bearer`. Habría que cambiarla para leer y emitir cookies, y agregar protección CSRF. |
| **CORS, con la web y la API en orígenes distintos** | Más configuración y una solicitud previa (preflight) por cada llamada con cabeceras. El proxy de nginx lo evita. |
| **Pedir la key de `/now` en tiempo de ejecución** (archivo de configuración servido por nginx) | Permite cambiar la key sin reconstruir la imagen, pero la key seguiría siendo pública y agrega una solicitud más. Con solo `read:now`, reconstruir es aceptable. |

## Consecuencias

- Cambiar la key de la pantalla informativa obliga a reconstruir la imagen `web`.
- La pantalla informativa funciona sin iniciar sesión, porque solo usa la API key.
- Si la API cae detrás de nginx, el navegador recibe un 502 (nginx deja de esperar a los 5 s), y la web lo muestra como "No se pudo conectar con el servidor".
