# Usar AgentSpace

[English](en.md) · [简体中文](zh-CN.md) · [日本語](ja.md) · [한국어](ko.md) · [Español](es.md)

AgentSpace reúne tus textos, material de proyectos y propuestas de agentes en un espacio local. Puedes leer, editar, organizar y recuperar trabajo sin una cuenta de un proveedor de modelos.

## Crear o abrir un espacio

Elige **Crear espacio** para una carpeta local nueva, **Abrir espacio** para una carpeta de AgentSpace existente o **Abrir espacio de ejemplo** para probar material ficticio guardado por separado de tu trabajo. El encabezado identifica el espacio seleccionado.

La aplicación y el espacio son independientes: mover la aplicación no mueve los datos. Colócala en su ubicación habitual antes de generar la configuración del agente; vuelve a generarla si cambia la ruta del ejecutable.

En **Ajustes** puedes elegir el idioma y el tamaño del texto. Cambiar el idioma no traduce los títulos, textos ni etiquetas de campos que hayas escrito.

## Retomar el trabajo o encontrar material

**Continuar trabajando** ofrece borradores de recuperación, hasta diez elementos recientes de esta instancia y **Ver cambios recientes**. La lista apunta al mismo material, sin guardar copias de documentos. Quitar un elemento no disponible de la lista no borra el material. Puedes reintentar errores temporales; una instancia restaurada mantiene su propia lista.

Usa **Biblioteca** para explorar, buscar y filtrar material guardado, o elige **Nuevo material**. Puede haber contenido aunque no aparezca trabajo reciente. Los recuentos y las páginas describen el ámbito consultado; carga más resultados si los necesitas.

## Importar material existente

Abre **Importar material existente** desde Continuar, el menú del espacio o una vista vacía de Biblioteca sin filtros.

1. Selecciona archivos o una carpeta.
2. Comprueba la vista previa: copias de texto, grupos de proyectos, referencias externas, elementos omitidos y límites del recorrido.
3. Confirma la selección y consulta el resultado de cada elemento.

Markdown y texto plano en UTF-8 válido se convierten en copias gestionadas editables con información de origen. Los archivos originales no cambian. Los repositorios y otros formatos pueden seleccionarse como referencias externas; su contenido no se copia, ejecuta ni sincroniza. El perfil que reconoce knowledge, projects, HANDOFF y repos ayuda a sugerir grupos y es opcional.

Una vista previa limitada solo cubre el recorrido indicado. Si cambia una fuente después, vuelve a comprobarla y confirmarla. La importación guarda cada elemento por separado, por lo que los éxitos se conservan ante fallos parciales. Reintentar o importar la misma versión de origen reutiliza el objeto inicial y conserva las ediciones humanas posteriores y las relaciones actuales. La agrupación nueva se aplica a las copias nuevas; cambia explícitamente las relaciones de un objeto reutilizado. Otra versión de origen crea una copia independiente.

No hay sincronización de archivos en segundo plano. Tras reiniciar, reanuda explícitamente una importación incompleta. Un espacio restaurado requiere volver a seleccionar y confirmar las fuentes de sus importaciones anteriores.

## Escribir y guardar

Desde **Nuevo material** puedes crear una nota independiente, un proyecto, un registro o un recurso reutilizable. Una nota no tiene que pertenecer a un proyecto. Edita campos y relaciones en **Detalles** para usar una misma nota o recurso desde varios proyectos sin duplicarlo.

Las ediciones humanas se guardan directamente tras una pausa breve; también puedes usar **Guardar ahora**. Comprueba el estado junto al editor:

- **Guardado** confirma que las ediciones visibles están guardadas como contenido actual.
- **Borrador de recuperación conservado** confirma que hay un borrador retenido, separado del guardado del contenido.
- **Sin guardar** o **Comprobando el resultado del guardado…** requiere atención. Mantén abierto el editor y usa el reintento disponible para resolver la solicitud original.

En un conflicto, tus ediciones y la versión guardada más reciente se mantienen separadas. Consulta el original actual antes de decidir cómo seguir. Si tampoco se puede conservar el borrador, **Copiar cambios** copia el texto del cuerpo para guardarlo aparte antes de cerrar. Retoma los borradores conservados desde Continuar; abrir un borrador no lo convierte en contenido aceptado.

Los registros admiten texto, números finitos, booleanos, fechas y opciones. Sin establecer (`null`), texto vacío, `0` y `false` son valores distintos. Cambiar la etiqueta conserva la identidad del campo; cambiar su tipo deja el valor sin establecer. Reutilizar campos crea un registro nuevo con valores sin establecer, sin copiar texto ni enlaces. La tabla es una vista acotada de los mismos registros y toma sus columnas del registro de referencia elegido.

## Consultar un proyecto y sus fuentes

El resumen del proyecto muestra el extracto de su objetivo, referencias para continuar, referencias directas a recursos y material por páginas. Elige **Editar texto del proyecto** para escribir el texto completo, o **Editar objetivo del proyecto** si está vacío. Los recuentos indican material cargado o referencias registradas. Usa campos y enlaces de continuidad según lo necesites, sin una rutina obligatoria.

Las relaciones pueden **Seguir versión actual** o apuntar a una **Versión fijada**. Una cita conserva la versión guardada exacta aunque después edites la fuente. Los enlaces de un proyecto histórico y el material actual del proyecto se muestran por separado; no forman una instantánea completa de sus relaciones pasadas.

En el lector de fuentes, **Editar original actual** abre la versión actual del mismo objeto gestionado. Por ejemplo, leer la versión 1 y editar la versión 2 actual crea la versión 3 del mismo objeto; la versión 1 y sus citas no cambian. Si ya hay ediciones sin guardar, permanecen en su editor con su versión de base y cualquier conflicto visibles. **Volver a la lectura** recupera la versión citada y la posición anterior. Que el original actual esté archivado o no disponible no elimina el historial que siga siendo legible. Esta acción edita la copia gestionada, no el archivo de origen externo.

## Preparar contexto para un agente

Desde un documento guardado o el lector de fuentes, elige **Preparar contexto**.

1. Si lo necesitas, describe la tarea en hasta 1.000 puntos de código Unicode.
2. Selecciona hasta **20 referencias únicas a versiones guardadas**. Al principio solo está seleccionado el elemento de partida. Los candidatos son los enlaces directos de esa versión y, si partes de un proyecto, su material activo actual. Puedes cargar más dentro de cada grupo.
3. Abre **Revisar explicación y referencias**, comprueba el texto visible y usa **Copiar explicación y referencias**.

La explicación contiene la tarea y referencias fijadas. Si está seleccionado el proyecto de partida, puede incluir hasta 280 caracteres de su objetivo; al desmarcarlo se eliminan su título y extracto. No incorpora recursivamente los textos enlazados. Una selección no disponible requiere reintento o eliminación; nunca se sustituye por una versión nueva.

El éxito de la copia significa que el texto llegó al portapapeles. No crea permisos ni confirma que un agente lo haya recibido. La preparación queda en memoria mientras el espacio está abierto, incluso al visitar Ajustes o Importar; no es un documento guardado ni un borrador recuperable tras reiniciar.

## Conectar un agente con permisos explícitos

Elige **Configurar acceso de agentes** desde la preparación o abre esa sección en **Ajustes**.

1. Da un nombre al permiso, elige objetos concretos o todo el espacio y selecciona lectura y propuestas.
2. Comprueba la selección, incluido el material preparado fuera de la primera página. Se conservan las elecciones del formulario; **Usar material seleccionado** las sustituye de forma explícita.
3. Pulsa **Crear permiso de acceso**, copia la configuración de Codex o el JSON de inicio stdio, añádelo a los ajustes MCP del anfitrión y vuelve a conectar. Después entrega la explicación al agente. La [guía del protocolo](../AGENT_PROTOCOL.md) también documenta la CLI.

La explicación fija versiones concretas, pero el permiso de un objeto abarca sus versiones legibles, **incluidas las futuras**. Los enlaces nuevos y el material del proyecto no añaden objetos a una selección fija. Proponer notas o registros nuevos requiere un permiso de creación adicional en un acceso a todo el espacio con lectura y propuestas. Un permiso limitado a ciertos objetos no permite crear otros. El agente no recibe tu autoridad para guardar directamente ni aplicar propuestas.

La configuración contiene un token que se muestra una sola vez; AgentSpace guarda su hash. Cópialo mientras esté disponible. Si lo pierdes, revoca el acceso y crea otro. Una operación de acceso incierta bloquea el formulario hasta resolver el reintento de la solicitud original. Ir y volver de Ajustes en el mismo espacio abierto conserva la configuración de una sola visualización ya recibida.

Un agente puede descubrir material, filtrar, buscar, seguir relaciones acotadas y leer versiones exactas dentro de su permiso. La búsqueda indica límites y no garantiza exhaustividad semántica. “Contexto preparado” registra las referencias y los rangos reunidos para resultados de herramientas; no demuestra recepción, comprensión del modelo ni finalización de la tarea.

## Revisar propuestas y consultar cambios

Abre **Revisión → Pendientes** para consultar una propuesta.

1. Lee el propósito, el motivo, el destino, la versión de base y todas las diferencias. Abre las fuentes en sus versiones citadas; al volver se conserva la propuesta seleccionada y la posición de lectura.
2. Para una actualización, elige **Aplicar propuesta**. Para un objeto nuevo, elige **Crear nota** o **Crear registro**. **Rechazar propuesta** no cambia el contenido aceptado.
3. Usa **Borrador de material nuevo** en una propuesta de creación para iniciar tu propio borrador del mismo tipo. Para una actualización, edita el objeto actual. La propuesta original se conserva por separado.

Leer una propuesta no la resuelve. Leída/no leída, pendiente/aplicada/rechazada/en conflicto y la revisión humana del conocimiento son estados distintos. Si la versión de base ha avanzado, se bloquea la aplicación y se conservan ambas versiones. Usa **Copiar contenido propuesto** y edita el objeto actual, o pide una propuesta nueva al agente. Puedes rechazar un candidato antiguo después de revocar su acceso de origen.

En **Revisión → Procesadas** consulta propuestas aplicadas o rechazadas. **Leer la versión aceptada** abre el resultado guardado al aplicarla; otra acción abre el original actual. Las propuestas rechazadas conservan su motivo, diferencias y fuentes.

**Actividad → Cambios reales** muestra guardados y decisiones sobre propuestas, con fecha, autor y enlaces a la versión de ese evento o a la propuesta original. Otro agente autorizado puede consultar las explicaciones aceptadas y sus fuentes sin el chat original. El permiso para leer un resultado no concede acceso automático a sus fuentes.

En **Historial**, usa **Revisar antes de deshacer**. Deshacer rechaza sobrescribir ediciones posteriores. También puedes leer una versión antigua o crear una nota nueva a partir de ella.

## Marcar el conocimiento que has revisado

En **Detalles → Revisión de versiones**, compara la versión guardada actual con la última revisada por una persona. Después de comprobar la versión guardada actual, elige **Marcar como revisado**. Los cambios sin guardar quedan separados.

En Biblioteca, **Estado de revisión** permite buscar **Sin revisar**, **Versión actual revisada** y **Cambios desde la revisión**. Sin revisar es información neutral. Importar, guardar, leer o aplicar propuestas no marca el conocimiento como revisado. La marca registra la revisión humana de esa versión; no certifica la verdad ni mantiene el conocimiento automáticamente.

## Archivar material o reconectar un recurso externo

**Detalles → Archivar material** lo retira de las vistas activas conservando su identidad e historial. **Restaurar del archivo** lo reactiva. Archivar un proyecto no archiva ni elimina sus notas o recursos compartidos.

Si un recurso externo se mueve, usa **Elegir ubicación del recurso** y confirma la ubicación anterior y la nueva. Conserva su identidad e historial; volver a enlazarlo no mueve el archivo externo. Deshacer no revierte la ubicación. Para volver a la anterior, selecciónala explícitamente.

## Crear copias, exportar y restaurar

Abre **Copias, exportación y restauración** desde el menú del espacio.

| Opción                      | Uso                                          | Incluye                                                                                                           |
| --------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Copia de seguridad completa | Restaurar el espacio con su historial        | Base coherente, versiones conservadas, propuestas, historial de operaciones, borradores y progreso de importación |
| Exportación legible         | Leer contenido actual con otras herramientas | Contenido aceptado actual, incluidos archivados, campos tipados, relaciones y metadatos de origen                 |

La exportación legible excluye textos históricos, propuestas y borradores de recuperación; no sirve para restaurar todo el historial. Una cita histórica puede apuntar a un texto fuera de la exportación. Ninguna opción copia archivos o repositorios externos. Ambas pueden contener rutas de origen y otros metadatos personales.

Espera a **Completado y verificado** antes de dar la operación por terminada. Si se pierde la respuesta, el resultado es desconocido: comprueba la operación original o reinténtala. Si no puedes abrir una restauración completada, reintenta la apertura por separado; eso no anula la restauración verificada.

Restaura una copia en un **destino nuevo**. Recibe una identidad de instancia nueva y los permisos antiguos se desactivan en esa copia. El espacio original y sus permisos no cambian; conecta los agentes de nuevo de forma explícita. La recuperación puede encontrar borradores de otra instalación y copiar uno seleccionado a un borrador local nuevo, conservando el original.

## Privacidad, límites y ayuda

AgentSpace no cifra los datos locales. Protege el espacio y sus copias con el sistema operativo. Un agente conectado puede recibir contenido autorizado, que su anfitrión puede enviar a un proveedor de modelos según sus ajustes. Guardar en local no impide ese envío. Revocar el acceso bloquea futuras llamadas, pero no recupera material ya compartido.

Un objeto gestionado admite hasta 1 MiB y la base, incluido el historial, hasta 512 MiB. La importación tiene límites de profundidad 12, 1.000 entradas visitadas y 50 MiB de texto seleccionado, entre otros. Las herramientas de contexto también limitan resultados y bytes. Un espacio lleno aún puede copiarse o exportarse a un destino con permiso de escritura.

Consulta el [alcance del producto](../PRD.md), los [datos locales y la recuperación](../LOCAL_DATA.md) y los [límites de confianza](../SECURITY.md). El entorno actual es macOS Apple Silicon; [configuración de escritorio](../DESKTOP.md) y [verificación](../TESTING.md) explican los límites de firma, plataforma y comprobación de métodos de entrada.
