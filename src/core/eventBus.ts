//@ts-nocheck
type EventHandler = (data?: any) => void;

class EventBusManager {
  private listeners: Map<string, Set<EventHandler>> = new Map();

  on(event: string, handler: EventHandler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    // Retorna función para des-suscribirse fácilmente
    return () => this.off(event, handler);
  }

  off(event: string, handler: EventHandler) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.delete(handler);
    }
  }

  emit(event: string, data?: any) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error en handler para evento ${event}:`, err);
        }
      });
    }
  }
}

export const EventBus = new EventBusManager();
