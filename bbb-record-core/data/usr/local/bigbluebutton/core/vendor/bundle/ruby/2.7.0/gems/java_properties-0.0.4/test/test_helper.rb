require 'test/unit'
require File.dirname(__FILE__) + '/../lib/java_properties'
require File.dirname(__FILE__) + '/test_data.rb'

def create_test_files
  remove_test_files
  File.open(TestJavaPropertiesData.file1,'w') { |f| f.write TestJavaPropertiesData.properties_contents1 }
  File.open(TestJavaPropertiesData.file2,'w') { |f| f.write TestJavaPropertiesData.properties_contents2 }
  #File.open(TestJavaPropertiesData.file3,'w') { |f| f.write TestJavaPropertiesData.properties_contents3 }
  File.open(TestJavaPropertiesData.file4,'w') { |f| f.write TestJavaPropertiesData.properties_contents4 }
end

def remove_test_files
  File.delete(TestJavaPropertiesData.file1) if File.exist?(TestJavaPropertiesData.file1)
  File.delete(TestJavaPropertiesData.file2) if File.exist?(TestJavaPropertiesData.file2)
  File.delete(TestJavaPropertiesData.file3) if File.exist?(TestJavaPropertiesData.file3)
  File.delete(TestJavaPropertiesData.file4) if File.exist?(TestJavaPropertiesData.file4)
end

def get_file_as_string file_name
    if File.exist?(file_name) then
      file_contents = ''
      File.open(file_name,'r') do |f|
	while(line = f.gets) do
	  file_contents += line
	end
      end
      file_contents
    else
      nil
    end
end