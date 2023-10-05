import { expect } from 'chai';
import { FileUploader as FileUploaderDll, icons } from '../src';
import FileUploader from '../src/fileuploader';

import fileUploadIcon from './../theme/icons/file-arrow-up-solid.svg';

describe( 'CKEditor5 FileUploader DLL', () => {
	it( 'exports FileUploader', () => {
		expect( FileUploaderDll ).to.equal( FileUploader );
	} );

	describe( 'icons', () => {
		it( 'exports the "fileupload icon" icon', () => {
			expect( icons.fileUpload ).to.equal( fileUploadIcon );
		} );
	} );
} );
