export class ServiceRegistry {
    services = new Map();
    registerService(service) {
        this.services.set(service.serviceName, service);
        console.log(`📋 Service enregistré: ${service.displayName} (${service.serviceName})`);
    }
    getService(serviceName) {
        return this.services.get(serviceName);
    }
    getAllServices() {
        return Array.from(this.services.values());
    }
    getServiceNames() {
        return Array.from(this.services.keys());
    }
    getEnabledServices() {
        return this.getAllServices().filter(service => service.isEnabled());
    }
    getServicesConfig() {
        return this.getAllServices().map(service => ({
            name: service.serviceName,
            displayName: service.displayName,
            isEnabled: service.isEnabled()
        }));
    }
    hasService(serviceName) {
        return this.services.has(serviceName);
    }
    getStats() {
        const total = this.services.size;
        const enabled = this.getEnabledServices().length;
        return {
            total,
            enabled,
            disabled: total - enabled,
            services: this.getServicesConfig()
        };
    }
}
