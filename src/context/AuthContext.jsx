import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [session, setSession] = useState(undefined); // undefined = loading

    useEffect(() => {
        // Hydrate from existing session
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session ?? null);
        });

        const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
            setSession(sess);
        });

        return () => listener.subscription.unsubscribe();
    }, []);

    // ── Email OTP ──────────────────────────────────────────────────────────────
    async function signInWithEmail(email) {
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true },
        });
        if (error) throw error;
    }

    // ── Phone OTP ──────────────────────────────────────────────────────────────
    async function signInWithPhone(phone) {
        const { error } = await supabase.auth.signInWithOtp({ phone });
        if (error) throw error;
    }

    // ── OTP Verification ───────────────────────────────────────────────────────
    async function verifyOtp({ credential, token, type }) {
        const payload =
            type === 'email'
                ? { email: credential, token, type: 'email' }
                : { phone: credential, token, type: 'sms' };

        const { data, error } = await supabase.auth.verifyOtp(payload);
        if (error) throw error;
        return data;
    }

    // ── Sign Out ───────────────────────────────────────────────────────────────
    async function signOut() {
        await supabase.auth.signOut();
    }

    const value = {
        session,
        user: session?.user ?? null,
        isLoading: session === undefined,
        signInWithEmail,
        signInWithPhone,
        verifyOtp,
        signOut,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}
