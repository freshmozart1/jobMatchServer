const ALLOWED_CERTIFICATE_MIMETYPES =
    /^(application\/pdf|image\/(jpeg|jpg|png))$/;

export default function isAllowedCertificateMimetype(
    mimetype: string,
): boolean {
    return ALLOWED_CERTIFICATE_MIMETYPES.test(mimetype);
}
