// src/core/ServiceRegistry.ts - Registre central des services

import { BaseService } from "./BaseService.js";
import { ServiceConfig } from "../types/index.js";

export class ServiceRegistry {
	private services = new Map<string, BaseService>();

	// Enregistrer un nouveau service
	registerService(service: BaseService): void {
		this.services.set(service.serviceName, service);
		console.log(`📋 Service enregistré: ${service.displayName} (${service.serviceName})`);
	}

	// Récupérer un service par nom
	getService(serviceName: string): BaseService | undefined {
		return this.services.get(serviceName);
	}

	// Obtenir tous les services
	getAllServices(): BaseService[] {
		return Array.from(this.services.values());
	}

	// Obtenir les noms de tous les services
	getServiceNames(): string[] {
		return Array.from(this.services.keys());
	}

	// Obtenir les services activés
	getEnabledServices(): BaseService[] {
		return this.getAllServices().filter(service => service.isEnabled());
	}

	// Obtenir la configuration de tous les services
	getServicesConfig(): ServiceConfig[] {
		return this.getAllServices().map(service => ({
			name: service.serviceName,
			displayName: service.displayName,
			isEnabled: service.isEnabled()
		}));
	}

	// Vérifier si un service existe
	hasService(serviceName: string): boolean {
		return this.services.has(serviceName);
	}

	// Obtenir les statistiques
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
