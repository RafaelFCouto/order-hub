import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** Cliente Supabase (anon) usado para validar o JWT do usuário. */
@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  readonly client: SupabaseClient | null;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      this.logger.warn(
        'SUPABASE_URL/SUPABASE_ANON_KEY ausentes — auth desativada até configurar.',
      );
      this.client = null;
      return;
    }
    this.client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
}
