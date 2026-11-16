export const documentDirectory = 'file:///data/khidmat/';
export const copyAsync = async () => { throw new Error('no device file system in tests'); }; // the picked uri is kept
export const makeDirectoryAsync = async () => undefined;
export const deleteAsync = async () => undefined;
