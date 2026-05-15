import packageJson from "../package.json";

type ExtensionPackageMetadata = {
  publisher?: string;
  name?: string;
};

const metadata = packageJson as ExtensionPackageMetadata;

function requirePackageField(value: string | undefined, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`package.json must define a non-empty ${fieldName}`);
  }

  return value;
}

export const cockpitExtensionPublisher = requirePackageField(metadata.publisher, "publisher");
export const cockpitExtensionName = requirePackageField(metadata.name, "name");
export const cockpitExtensionId = `${cockpitExtensionPublisher}.${cockpitExtensionName}`;
export const cockpitExtensionSettingsQuery = `@ext:${cockpitExtensionId}`;
