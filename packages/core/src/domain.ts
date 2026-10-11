/** Erro de regra de negócio, com mensagem pronta para mostrar ao usuário. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
