import { ExperienceScreen } from '../../src/components/experience-screen';

export default function AudioScreen() {
  return <ExperienceScreen
    eyebrow="MOMENTIA / SOCIAL AUDIO"
    title="Escuchar en compañía"
    description="Coordina sesiones grupales, comparte una cola y mantén a todos al día en tiempo real."
    icon="♫"
    emptyTitle="El espacio de audio está preparado"
    emptyDescription="La API de sesiones y el gateway WebSocket están en desarrollo. El cliente aún necesita proveedor musical autorizado, controles de reproducción, heartbeat y reconexión."
  />;
}