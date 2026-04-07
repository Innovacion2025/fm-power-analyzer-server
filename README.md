# fm-power-analyzer-server

## Optimizaciones para Reducir Egress de Supabase

### Cambios Realizados

1. **Endpoint Incremental `/api/history/incremental`**:
   - Toma `device_id`, `pm_slave` y `since` (timestamp ISO).
   - Devuelve solo lecturas nuevas desde el timestamp especificado.
   - Limitado a 1000 resultados para seguridad.

2. **Optimización de `/api/history`**:
   - Si no se especifica `from`/`to`, ahora carga solo el día actual en lugar de todo el histórico.
   - Reduce drasticamente el egress para cargas iniciales.

3. **Nuevo Endpoint `/api/history/latest-timestamp`**:
   - Devuelve el último `created_at` para un device/pm_slave.
   - Útil para inicializar el `since` en actualizaciones incrementales.

4. **Dashboard Optimizado (`index.html`)**:
   - Carga inicial: Usa `/api/history` para datos del día actual.
   - Monitoreo en tiempo real: Usa polling cada 5 segundos con `/api/history/incremental`.
   - Agrega nuevos puntos al gráfico sin recargar todo el histórico.

### Arquitectura Optimizada

- **Carga Inicial**: `/api/history` (día actual).
- **Actualizaciones**: `/api/history/incremental` (solo nuevos datos).
- **Sin Recargas Completas**: El dashboard mantiene el estado y solo agrega puntos nuevos.

### Beneficios

- **Reducción de Egress**: De recargar todo el histórico cada polling a solo nuevos datos.
- **Mejor Rendimiento**: Gráficos más responsivos, menos datos transferidos.
- **Escalabilidad**: Maneja históricos grandes sin impacto en tiempo real.

### Uso del Dashboard

1. Abrir `http://localhost:puerto/` (donde corre el servidor).
2. Ingresar Device ID y PM Slave.
3. Hacer clic en "Cargar Datos Iniciales".
4. Hacer clic en "Iniciar Monitoreo en Tiempo Real" para actualizaciones automáticas.