<p align="center"><img src="docs/assets/banner.svg" alt="AgentSpace" width="1200"></p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · Español</p>

AgentSpace es un espacio local para escribir, reunir material de proyectos y colaborar con distintos agentes. Consulta las fuentes, examina las propuestas y decide qué cambios incorporar a tu trabajo.

Puedes usarlo sin una cuenta de un proveedor de modelos ni una clave API. Conecta un agente externo cuando quieras ayuda para leer o modificar material.

<img src="docs/assets/workbench.es.png" alt="El escritorio de AgentSpace con material de ejemplo" width="1200">

## Qué puedes hacer

- **Escribir y retomar.** Edita Markdown, conserva borradores de recuperación y vuelve al trabajo reciente.
- **Reunir el contexto de un proyecto.** Relaciona notas, documentos, registros con campos tipados y recursos reutilizables. Consulta el texto, las referencias de continuidad y el material acumulado de cada proyecto.
- **Preparar el contexto inicial de un agente.** Comprueba una explicación con referencias a versiones guardadas y crea permisos explícitos de MCP o CLI.
- **Revisar cambios.** Lee el motivo, las diferencias y las fuentes antes de aplicar o rechazar una propuesta. Consulta la versión aceptada y deshaz cambios protegiendo las ediciones posteriores.
- **Conservar y trasladar datos.** Importa copias editables sin modificar los originales; crea una copia de seguridad completa o una exportación legible del contenido actual.
- **Elegir idioma.** Inglés, chino simplificado, japonés, coreano y español. El contenido que escribes conserva su idioma.

<img src="docs/assets/review.es.png" alt="Una propuesta de agente con su motivo, diferencias y versiones citadas" width="1200">

## Ejecutar en local

El entorno de escritorio actual es **macOS Apple Silicon**. Para ejecutar desde el código fuente:

```sh
git clone https://github.com/li508q/agent-space.git
cd agent-space
npm ci
npm run dev
```

Usa la versión de Node indicada en [`.nvmrc`](.nvmrc). Crea un espacio, abre uno existente o prueba el espacio de ejemplo, que se guarda por separado. [Guía de uso →](docs/guides/es.md)

En un Mac con Apple Silicon, `npm run package:mac` crea una aplicación independiente con su propio entorno de ejecución. Consulta [configuración de escritorio](docs/DESKTOP.md) para los detalles de compilación, firma y plataforma.

Abre **Ajustes → Configurar acceso de agentes**, elige los objetos y permisos y copia la configuración generada a tu anfitrión MCP. Crear notas o registros requiere un permiso adicional. [MCP y CLI →](docs/AGENT_PROTOCOL.md)

## Datos y permisos

Los espacios son archivos locales que tú controlas. AgentSpace no los cifra; usa las funciones del sistema operativo para proteger tus datos y copias. Los archivos a los que apuntan los recursos externos se gestionan por separado.

Un agente conectado puede recibir material autorizado y su anfitrión puede enviarlo a un proveedor de modelos según su configuración. Guardar en local no impide ese envío. Revocar el acceso bloquea futuras solicitudes de herramientas, pero no recupera contenido ya compartido. Preparar o copiar contexto no acredita que el modelo lo haya entendido ni que haya terminado una tarea.

[Datos y confianza](docs/SECURITY.md) · [Copias y recuperación](docs/LOCAL_DATA.md)

## Desarrollo y contribuciones

Consulta la [guía de contribución](CONTRIBUTING.md) para el desarrollo y las comprobaciones, la [arquitectura](docs/ARCHITECTURE.md) para el núcleo compartido y [CI](https://github.com/li508q/agent-space/actions) para los resultados automatizados.

[Documentación](docs/README.md) · [Alcance del producto](docs/PRD.md) · [Verificación y límites](docs/TESTING.md) · [Licencia MIT](LICENSE)
