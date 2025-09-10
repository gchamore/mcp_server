import nodemailer from 'nodemailer';
export class EmailService {
    static async initialize() {
        try {
            if (process.env.SMTP_HOST) {
                this.transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT || '587'),
                    secure: process.env.SMTP_SECURE === 'true',
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS,
                    },
                });
            }
            else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
                this.transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: process.env.GMAIL_USER,
                        pass: process.env.GMAIL_APP_PASSWORD,
                    },
                });
            }
            else if (process.env.SENDGRID_API_KEY) {
                this.transporter = nodemailer.createTransport({
                    service: 'SendGrid',
                    auth: {
                        user: 'apikey',
                        pass: process.env.SENDGRID_API_KEY,
                    },
                });
            }
            else if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
                this.transporter = nodemailer.createTransport({
                    service: 'Mailgun',
                    auth: {
                        user: process.env.MAILGUN_USER || 'api',
                        pass: process.env.MAILGUN_API_KEY,
                    },
                });
            }
            else {
                if (process.env.NODE_ENV === 'development') {
                    const testAccount = await nodemailer.createTestAccount();
                    this.transporter = nodemailer.createTransport({
                        host: 'smtp.ethereal.email',
                        port: 587,
                        secure: false,
                        auth: {
                            user: testAccount.user,
                            pass: testAccount.pass,
                        },
                    });
                    console.log('📧 Mode développement: utilisation d\'Ethereal Email pour les tests');
                    console.log(`📧 Preview URL: https://ethereal.email`);
                }
                else {
                    console.warn('⚠️  Aucune configuration email trouvée');
                    return;
                }
            }
            if (this.transporter) {
                await this.transporter.verify();
                this.isConfigured = true;
                console.log('✅ Service d\'email initialisé avec succès');
            }
        }
        catch (error) {
            console.error('❌ Erreur lors de l\'initialisation du service email:', error);
            this.transporter = null;
            this.isConfigured = false;
        }
    }
    static getStatus() {
        if (!this.isConfigured) {
            return { configured: false };
        }
        let provider = 'Unknown';
        if (process.env.GMAIL_USER)
            provider = 'Gmail';
        else if (process.env.SENDGRID_API_KEY)
            provider = 'SendGrid';
        else if (process.env.MAILGUN_API_KEY)
            provider = 'Mailgun';
        else if (process.env.SMTP_HOST)
            provider = 'SMTP Custom';
        else if (process.env.NODE_ENV === 'development')
            provider = 'Ethereal (Dev)';
        return { configured: true, provider };
    }
    static async sendEmail(options) {
        if (!this.isConfigured || !this.transporter) {
            return {
                success: false,
                error: 'Service d\'email non configuré'
            };
        }
        try {
            const fromEmail = process.env.EMAIL_FROM || process.env.GMAIL_USER || 'noreply@wesype.com';
            const fromName = process.env.EMAIL_FROM_NAME || 'MCP Wesype';
            const fromAddress = `"${fromName}" <${fromEmail}>`;
            const mailOptions = {
                from: fromAddress,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
                headers: {
                    'Reply-To': process.env.EMAIL_REPLY_TO || fromEmail,
                    'Return-Path': fromEmail,
                    'X-Mailer': 'MCP Wesype Server v1.0.0'
                }
            };
            const info = await this.transporter.sendMail(mailOptions);
            let previewUrl;
            if (process.env.NODE_ENV === 'development' && info.messageId) {
                const url = nodemailer.getTestMessageUrl(info);
                previewUrl = url || undefined;
            }
            return {
                success: true,
                messageId: info.messageId,
                previewUrl
            };
        }
        catch (error) {
            console.error('❌ Erreur lors de l\'envoi d\'email:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    }
    static async sendPasswordResetEmail(data) {
        const { email, firstName, resetToken, resetUrl } = data;
        const subject = 'Réinitialisation de votre mot de passe - MCP Wesype';
        const html = this.generatePasswordResetHTML({
            firstName: firstName || 'Utilisateur',
            resetUrl,
            resetToken
        });
        const text = this.generatePasswordResetText({
            firstName: firstName || 'Utilisateur',
            resetUrl,
            resetToken
        });
        return this.sendEmail({
            to: email,
            subject,
            html,
            text
        });
    }
    static generatePasswordResetHTML(data) {
        return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Réinitialisation de mot de passe</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            border-radius: 10px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo {
            font-size: 24px;
            font-weight: bold;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .button {
            display: inline-block;
            padding: 12px 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            border-radius: 25px;
            font-weight: bold;
            margin: 20px 0;
        }
        .warning {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 5px;
            padding: 15px;
            margin: 20px 0;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            font-size: 12px;
            color: #666;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">MCP Wesype</div>
        </div>
        
        <h2>Réinitialisation de votre mot de passe</h2>
        
        <p>Bonjour ${data.firstName},</p>
        
        <p>Nous avons reçu une demande de réinitialisation de mot de passe pour votre compte MCP Wesype.</p>
        
        <p>Pour réinitialiser votre mot de passe, cliquez sur le bouton ci-dessous :</p>
        
        <div style="text-align: center;">
            <a href="${data.resetUrl}" class="button">Réinitialiser mon mot de passe</a>
        </div>
        
        <p>Ou copiez et collez ce lien dans votre navigateur :</p>
        <p style="word-break: break-all; background-color: #f8f9fa; padding: 10px; border-radius: 5px;">
            ${data.resetUrl}
        </p>
        
        <div class="warning">
            <strong>⚠️ Important :</strong>
            <ul>
                <li>Ce lien est valide pendant 1 heure seulement</li>
                <li>Il ne peut être utilisé qu'une seule fois</li>
                <li>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email</li>
            </ul>
        </div>
        
        <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
        
        <p>Cordialement,<br>L'équipe ${process.env.EMAIL_FROM_NAME || 'MCP Wesype'}</p>
        
        <div class="footer">
            <p>Cet email a été envoyé automatiquement par ${process.env.EMAIL_FROM_NAME || 'MCP Wesype'}.</p>
            <p>Merci de ne pas répondre à cette adresse. Pour toute question, contactez-nous à ${process.env.EMAIL_REPLY_TO || 'support@wesype.com'}.</p>
            <p>© 2025 ${process.env.EMAIL_FROM_NAME || 'MCP Wesype'}. Tous droits réservés.</p>
        </div>
    </div>
</body>
</html>`;
    }
    static generatePasswordResetText(data) {
        return `
Réinitialisation de votre mot de passe - MCP Wesype

Bonjour ${data.firstName},

Nous avons reçu une demande de réinitialisation de mot de passe pour votre compte MCP Wesype.

Pour réinitialiser votre mot de passe, cliquez sur le lien ci-dessous :
${data.resetUrl}

IMPORTANT :
- Ce lien est valide pendant 1 heure seulement
- Il ne peut être utilisé qu'une seule fois
- Si vous n'avez pas demandé cette réinitialisation, ignorez cet email

Si vous avez des questions, n'hésitez pas à nous contacter.

Cordialement,
L'équipe MCP Wesype

---
Cet email a été envoyé automatiquement, merci de ne pas y répondre.
© 2025 MCP Wesype. Tous droits réservés.
`;
    }
    static async sendPasswordChangeConfirmation(email, firstName) {
        const subject = 'Confirmation de changement de mot de passe - MCP Wesype';
        const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmation de changement de mot de passe</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            border-radius: 10px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo {
            font-size: 24px;
            font-weight: bold;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .success {
            background-color: #d1fae5;
            border: 1px solid #a7f3d0;
            border-radius: 5px;
            padding: 15px;
            margin: 20px 0;
            color: #065f46;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            font-size: 12px;
            color: #666;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">MCP Wesype</div>
        </div>
        
        <h2>Confirmation de changement de mot de passe</h2>
        
        <p>Bonjour ${firstName || 'Utilisateur'},</p>
        
        <div class="success">
            ✅ Votre mot de passe a été modifié avec succès le ${new Date().toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })}.
        </div>
        
        <p>Si vous n'êtes pas à l'origine de ce changement, contactez-nous immédiatement à ${process.env.EMAIL_REPLY_TO || 'support@wesype.com'}.</p>
        
        <p>Cordialement,<br>L'équipe ${process.env.EMAIL_FROM_NAME || 'MCP Wesype'}</p>
        
        <div class="footer">
            <p>Cet email a été envoyé automatiquement par ${process.env.EMAIL_FROM_NAME || 'MCP Wesype'}.</p>
            <p>Merci de ne pas répondre à cette adresse. Pour toute question, contactez-nous à ${process.env.EMAIL_REPLY_TO || 'support@wesype.com'}.</p>
            <p>© 2025 ${process.env.EMAIL_FROM_NAME || 'MCP Wesype'}. Tous droits réservés.</p>
        </div>
    </div>
</body>
</html>`;
        const text = `
Confirmation de changement de mot de passe - MCP Wesype

Bonjour ${firstName || 'Utilisateur'},

Votre mot de passe a été modifié avec succès le ${new Date().toLocaleDateString('fr-FR')}.

Si vous n'êtes pas à l'origine de ce changement, contactez-nous immédiatement à ${process.env.EMAIL_REPLY_TO || 'support@wesype.com'}.

Cordialement,
L'équipe ${process.env.EMAIL_FROM_NAME || 'MCP Wesype'}

---
Cet email a été envoyé automatiquement par ${process.env.EMAIL_FROM_NAME || 'MCP Wesype'}.
Merci de ne pas répondre à cette adresse. Pour toute question, contactez-nous à ${process.env.EMAIL_REPLY_TO || 'support@wesype.com'}.
© 2025 ${process.env.EMAIL_FROM_NAME || 'MCP Wesype'}. Tous droits réservés.
`;
        return this.sendEmail({
            to: email,
            subject,
            html,
            text
        });
    }
}
EmailService.transporter = null;
EmailService.isConfigured = false;
