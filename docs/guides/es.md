# Usar AgentSpace

[English](en.md) · [简体中文](zh-CN.md) · [日本語](ja.md) · [한국어](ko.md) · [Español](es.md)

AgentSpace reúne tu trabajo y la ayuda de agentes en un espacio local. Puedes escribir, organizar y recuperar contenido sin una cuenta de un proveedor de modelos. Un agente externo accede mediante permisos explícitos y propone cambios que puedes revisar.

## Abrir un espacio

Crea un espacio en una carpeta local nueva o abre una carpeta de AgentSpace existente. El encabezado identifica el espacio activo. El ejemplo se guarda por separado y está marcado como material sintético.

La aplicación y los datos son independientes. Mover la aplicación no mueve tu espacio. Genera la configuración del agente después de colocar la aplicación en su ubicación habitual; vuelve a generarla si cambia la ruta del ejecutable.

La primera entrega está verificada en macOS Apple Silicon. La compilación local tiene firma ad-hoc, sin Developer ID ni notarización. No se presentan otros sistemas como distribuciones verificadas. El desarrollo usa las versiones de Node indicadas en el repositorio.

## Escribir y relacionar contenido

Crea notas independientes cuando las necesites. Los proyectos agrupan contenido mediante relaciones: una nota puede pertenecer a varios proyectos y conservar una sola identidad. Los recursos también pueden reutilizarse desde distintos proyectos.

Las ediciones se guardan tras una pausa breve; también puedes guardar de inmediato. «Guardado» significa que la generación visible se ha persistido. Conservar un borrador de recuperación es un estado distinto. Ante un conflicto o un fallo, usa las opciones de reintento, borrador o copia. Una revisión posterior no se sobrescribe en silencio.

Un proyecto abre con un resumen: extracto de su texto, referencias para continuar, referencias directas a recursos y material paginado. Los botones de sección quedan fuera del texto completo. Elige **Editar texto del proyecto** para escribir; un proyecto vacío ofrece **Editar objetivo del proyecto**. Los recuentos indican elementos cargados o referencias registradas, no totales de todo el espacio. No se impone una rutina fija.

En el lector de fuentes, **Editar original actual** abre la versión actual del mismo objeto interno tras proteger el guardado o borrador. Leer K1 y editar K2 guarda K3 con el mismo ID; K1 y sus citas siguen fijados. Los cambios sin guardar de ese objeto permanecen en su editor, con su base y cualquier conflicto visibles. **Volver a la lectura** recupera la versión citada y la posición anterior. Si el original actual está archivado o no disponible, el historial legible se conserva. Esta acción modifica el objeto gestionado, no un archivo externo.

Los registros admiten texto, números finitos, booleanos, fechas y opciones. Las etiquetas pueden estar en cualquier idioma y conservan su clave al renombrarlas. Sin valor, texto vacío, cero y false son valores distintos. Reutilizar las definiciones crea un registro nuevo con valores vacíos. La tabla es una vista limitada de esos mismos registros, no un esquema global independiente.

Las relaciones distinguen objetos actuales y pruebas fijadas a una revisión. Editar una fuente no cambia la versión citada. La marca de revisión humana también corresponde a una versión concreta; guardar o aceptar no demuestra que el contenido sea verdadero.

## Importar carpetas existentes

Selecciona archivos o una carpeta y revisa las copias, los grupos de proyectos y las referencias externas antes de confirmar. Reconocer knowledge, projects, HANDOFF y repos es un perfil opcional, no una estructura obligatoria.

Markdown y texto plano en UTF-8 válido se convierten en copias editables. Los originales no cambian. Los repositorios y los formatos no admitidos pueden seleccionarse como referencias externas; sus bytes no se copian, ejecutan ni sincronizan. Importar conocimiento no lo marca como revisado.

Comprueba los límites del recorrido, los elementos omitidos y los avisos de truncamiento. Lo que no aparece no se considera inspeccionado. Si una fuente cambia tras la vista previa, debes revisarla de nuevo. Cada elemento se confirma por separado: los éxitos se conservan ante fallos parciales. Reintentar recupera la referencia original sin sobrescribir correcciones humanas posteriores. Una versión distinta de la fuente produce otra copia.

La agrupación elegida se aplica a las copias nuevas. Una versión ya importada reutiliza su objeto original y conserva sus relaciones actuales; esta importación no lo reasigna. Abre el objeto para cambiar sus relaciones de forma explícita.

No hay sincronización bidireccional en segundo plano. Continúa explícitamente después de reiniciar. Un espacio restaurado necesita una nueva selección y confirmación de sus antiguas fuentes.

## Conectar un agente y revisar cambios

Crea un permiso con nombre en la sección de acceso de agentes de los ajustes. Elige todo el espacio o ciertos objetos y las capacidades de lectura y propuesta. Solo un permiso para todo el espacio con lectura y propuestas puede habilitar además la creación de notas o registros. Los permisos limitados a objetos concretos no permiten crear objetos nuevos. Los enlaces no amplían el acceso a otros objetos.

Copia la configuración MCP generada al anfitrión o usa la [CLI](../AGENT_PROTOCOL.md). El token se devuelve una sola vez; la base conserva únicamente su hash. Si lo pierdes, revoca el permiso y emite otro. La configuración contiene una credencial.

El agente combina descripción del modelo, filtros, búsqueda literal, relaciones acotadas y lectura de versiones concretas. Una retrospectiva mensual es un ejemplo, no un flujo incorporado. La búsqueda informa de su alcance y no garantiza exhaustividad semántica.

Puedes copiar la versión guardada seleccionada junto con sus referencias. El texto sin guardar se identifica como borrador; no se presenta como una fuente aceptada. La actividad muestra las referencias de versión y los rangos de contenido preparados para las respuestas de las herramientas. Consulta el Historial del objeto para ver los cambios guardados y las pruebas de las propuestas aceptadas. Preparar una respuesta no confirma su recepción por el anfitrión, la comprensión del modelo ni la finalización de tareas externas, y tampoco muestra razonamiento privado.

Revisa el propósito, el motivo, las diferencias, la versión de base y las fuentes de la propuesta. Abre una fuente en la revisión citada y vuelve a la misma revisión de cambios. El contenido aceptado no cambia hasta que aplicas la propuesta. Si cambia la base, ambas versiones se conservan. Puedes rechazar un candidato incluso después de revocar su permiso. Deshacer protege el trabajo posterior; también puedes copiar una versión antigua a una nota nueva.

Los motivos y las fuentes aceptados siguen disponibles en el historial. Otro agente autorizado puede consultarlos sin el chat ni la clave de operación del primero. Leer el resultado no concede acceso automático a sus pruebas.

## Conservar y recuperar datos

Archivar retira el contenido de la vista activa sin eliminar su identidad ni su historial. Archivar un proyecto no borra sus notas o recursos compartidos. Si un recurso externo se mueve, elige su nueva ubicación tras comprobar la anterior; conserva su identidad e historial. Deshacer no revierte un cambio de ubicación externa; elige explícitamente la ubicación anterior si quieres volver a ella.

| Método                      | Incluye                                                                                         | Excluye                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Copia de seguridad completa | Base coherente, versiones retenidas, propuestas, recibos, borradores e historial de importación | Archivos originales y contenido de repositorios externos               |
| Exportación legible         | Contenido actual, incluidos archivados, campos, relaciones y metadatos de origen                | Textos históricos, propuestas, recibos, borradores y archivos externos |

La exportación sirve para intercambiar datos, no para restaurar todo el historial. Ambos artefactos pueden contener rutas de origen y otros metadatos personales. Espera a la confirmación verificada. Si se pierde la respuesta, el resultado es desconocido: consulta el estado o reintenta la misma operación.

Restaura en un destino nuevo. La copia recibe una identidad de instancia nueva y sus permisos antiguos se desactivan. El espacio original y sus permisos no cambian. Vuelve a conectar los agentes explícitamente. Los borradores de otra instalación se pueden consultar y copiar a un borrador nuevo; los originales permanecen intactos.

## Límites actuales

Un objeto completo admite hasta 1 MiB y la base, incluido el historial y los recibos, hasta 512 MiB. La importación inspecciona una profundidad de 12, hasta 1.000 entradas y 50 MiB de texto seleccionado. Los servicios de contexto tienen límites explícitos de bytes y resultados. Al alcanzar el máximo de la base aún puedes exportar o crear una copia en un destino con espacio disponible.

AgentSpace no cifra sus archivos. Usa la protección del sistema operativo. El anfitrión externo controla su proveedor y sus permisos fuera de estas herramientas. La sincronización en la nube, los equipos, la verificación semántica de hechos, la ejecución arbitraria de aplicaciones y una hoja de cálculo completa quedan fuera de esta versión. La primera versión pública usa el formato 2; los formatos de desarrollo no admitidos se rechazan sin modificar el original.

[Confianza](../SECURITY.md) · [Datos locales](../LOCAL_DATA.md) · [Protocolo](../AGENT_PROTOCOL.md) · [Verificación](../TESTING.md)
