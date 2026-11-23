<p align="center"><img src="docs/assets/banner.svg" alt="AgentSpace" width="1200"></p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · Español</p>

**Trabaja con IA. Mantén el control.**

Un espacio local para escribir y compartir contexto con distintos agentes. Consulta el motivo de cada propuesta, la versión citada y los cambios; tú decides qué pasa a formar parte de tu trabajo.

**Estado:** Versión local inicial. La base de colaboración está implementada; seguimos mejorando los flujos de uso. [Alcance de la verificación y trabajo pendiente](docs/PRODUCT_REVIEW.md).

<img src="docs/assets/workbench.es.png" alt="El escritorio real de AgentSpace con material de ejemplo sintético" width="1200">

## Qué puedes hacer

- **Escribir y organizar.** Reúne notas, documentos, proyectos, registros sencillos y referencias a recursos reutilizables.
- **Compartir contexto preciso.** Concede acceso mediante MCP o CLI con un alcance explícito. Combina filtros, búsqueda, relaciones y lectura de versiones concretas.
- **Entender los cambios.** Revisa el propósito, el motivo, las diferencias y las pruebas antes de aplicar una propuesta. El siguiente agente autorizado puede consultar las explicaciones aceptadas.
- **Conservar tu trabajo.** Recupera borradores, consulta el historial y deshaz sin sobrescribir ediciones posteriores.
- **Traer y llevar tus datos.** Revisa la importación de carpetas y crea una copia con todo el historial o una exportación legible del contenido actual.
- **Elegir tu idioma.** Interfaz en inglés, chino simplificado, japonés, coreano y español. Tu contenido conserva su idioma original.

Funciona sin una cuenta de un proveedor de modelos. Conecta los agentes que ya usas cuando quieras su ayuda.

<img src="docs/assets/review.es.png" alt="Una propuesta real con su motivo, diferencias y fuentes exactas" width="1200">

## Empezar en local

La primera entrega está dirigida a macOS Apple Silicon. Usa la aplicación compilada localmente o ejecuta el código fuente:

```sh
git clone https://github.com/li508q/agent-space.git
cd agent-space
npm ci
npm run dev
```

Usa la versión de Node indicada en [`.nvmrc`](.nvmrc). Abre el espacio de ejemplo identificado o crea uno propio. [Guía de uso →](docs/guides/es.md)

En un Mac con Apple Silicon, `npm run package:mac` crea una aplicación independiente con su propio entorno de ejecución. [Compilación de escritorio →](docs/DESKTOP.md)

En la sección de acceso de agentes de los ajustes, elige el alcance y los permisos y copia la configuración generada. Crear notas o registros requiere un permiso adicional. Las propuestas solo se convierten en contenido aceptado después de tu revisión. [MCP y CLI →](docs/AGENT_PROTOCOL.md)

## Límites claros

El escritorio Electron y los adaptadores reales de MCP y CLI comparten un núcleo SQLite transaccional. Los identificadores estables, las relaciones tipadas, las versiones exactas de las fuentes y los recibos persistentes mantienen a todos los clientes sobre los mismos datos. React y CodeMirror ofrecen el editor; una API aislada y limitada media las acciones nativas.

Los datos se guardan localmente. Un agente externo recibe el material que solicita mediante sus permisos; su anfitrión gestiona el proveedor de modelos. El registro de referencias preparadas no revela el razonamiento privado del modelo ni acredita que una tarea externa haya terminado.

[Arquitectura](docs/ARCHITECTURE.md) · [Datos y confianza](docs/SECURITY.md) · [Verificación](docs/TESTING.md)

## Contribuir

```sh
npm run check
npm run format:check
npm run build
```

Consulta la [guía de contribución](CONTRIBUTING.md), los [requisitos](docs/PRD.md) y el [índice](docs/README.md). Esta versión se centra en el trabajo local de una persona; la colaboración en la nube, el chat general, las integraciones amplias y la ejecución de aplicaciones quedan fuera de su alcance.

[Licencia MIT](LICENSE). La guía explica los límites de plataforma y de verificación de la compilación local.
